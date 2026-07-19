// simulate-rule-batch — Roda o motor real sobre uma lista de itens (ex: planilha
// de teste do analista) e devolve, para cada item:
//   - status: ok | sem_regra | divergente | hospital_errado
//   - expected_amount calculado, gross_amount informado, diff e diff_pct
//   - matched_rule_id/name (no escopo do hospital alvo)
//   - leaked_rules: regras de OUTROS hospitais que também casariam (alerta de escopo)
//
// Não persiste nada. Sem IA. Pensado para uso pelo simulador em lote.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
  type ReferenceTableLookup,
  type ExceptionTableLookup,
} from "../_shared/rulesEngine.ts";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import { assertHospitalAccess } from "../_shared/hospitalAccessGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimItem {
  id?: string;
  procedure_code?: string | null;
  procedure_name?: string | null;
  agreement_name?: string | null;
  doctor_name?: string | null;
  doctor_document?: string | null;
  doctor_role?: string | null;
  access_route?: string | null;
  sector?: string | null;
  specialty?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  attendance_number?: string | null;
  patient_name?: string | null;
  procedure_date?: string | null;
  gross_amount?: number | null;
  procedure_amount?: number | null;
  quantity?: number | null;
  tipo_linha?: string | null;
}

interface BatchInput {
  items: SimItem[];
  hospital_id: string;
  payment_type?: string | null;
  reference_date?: string | null;
  tolerance_pct?: number;   // default 0.5 (= 0.5%)
  tolerance_abs?: number;   // default 1.00 R$
}

const RULE_SELECT = `
  id,name,rule_text,description,active,severity,scope,hospital_id,
  target_type,target_identifier,target_name,target_company_id,target_doctor_id,
  valid_from,valid_until,
  calculation_type,convenio_percentage,fixed_amount,package_amount,extras_codes,
  package_main_code,package_included_codes,package_visits_count,package_opinions_count,package_auxiliaries_included,package_subtype,
  reference_table_id,multiplier,deflator_pct,repasse_pct,
  apply_access_route,include_auxiliaries,auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
  exclusion_reason,allows_authorized_exception,
  agreement_name,agreement_match_mode,
  exception_table_ids,
  group_company_links,group_doctors,
  bonus_amount,bonus_pct,target_amount,
  limiar_alerta_tipo,limiar_alerta_valor,limiar_bloqueio_tipo,limiar_bloqueio_valor,
  force_totalized,
  prevent_external_fallback
`;

const CALC_SELECT = `
  id,rule_id,label,sort_order,calculation_type,
  time_mode,time_start,time_end,weekdays,includes_holidays,elective_mode,
  convenio_percentage,fixed_amount,
  package_amount,package_main_code,package_included_codes,package_visits_count,
  package_opinions_count,package_auxiliaries_included,package_subtype,extras_codes,
  reference_table_id,multiplier,deflator_pct,repasse_pct,acrescimo_pct,
  apply_access_route,include_auxiliaries,
  auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
  bonus_amount,bonus_pct,target_amount,allowed_access_routes,
  force_totalized,application_unit,sectors,specialties,special_case_filter,item_type_id,
  procedure_codes,code_match_mode,doctor_roles,
  agreement_match_mode,agreement_aliases,context_conditions,
  adicional_fds_pct,adicional_feriado_pct,adicional_noturno_pct,adicional_urgencia_pct,noturno_inicio,noturno_fim,
  is_catch_all
`;

async function attachCalcs(supabase: any, rules: RuleInput[]) {
  if (rules.length === 0) return;
  const ids = rules.map((r) => r.id);
  const { data: calcRows } = await supabase
    .from("rule_calculations")
    .select(CALC_SELECT)
    .in("rule_id", ids)
    .order("sort_order", { ascending: true });
  const byRule: Record<string, any[]> = {};
  for (const c of (calcRows ?? []) as any[]) (byRule[c.rule_id] ||= []).push(c);
  for (const r of rules) {
    const list = byRule[r.id] ?? [];
    if (list.length > 0) (r as any).calculations = list;
  }
}

function buildItem(it: SimItem, idx: number): ItemInput {
  return {
    id: it.id ?? `sim-${idx}`,
    doctor_name: it.doctor_name ?? null,
    doctor_document: it.doctor_document ?? null,
    company_name: it.company_name ?? null,
    company_id: it.company_id ?? null,
    company_document: null,
    procedure_code: (it.procedure_code ?? "").toString().trim() || null,
    procedure_name: it.procedure_name ?? null,
    description: null,
    access_route: it.access_route ?? null,
    doctor_role: it.doctor_role ?? null,
    procedure_amount: it.procedure_amount ?? null,
    gross_amount: Number(it.gross_amount ?? 0),
    attendance_number: it.attendance_number ?? null,
    patient_name: it.patient_name ?? null,
    procedure_date: it.procedure_date ?? null,
    quantity: it.quantity ?? 1,
    agreement_name: it.agreement_name ?? null,
    specialty: it.specialty ?? null,
    sector: it.sector ?? null,
    tipo_linha: it.tipo_linha ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireInternalOrRole(req);
    if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

    const body = (await req.json()) as BatchInput;
    if (!body?.hospital_id) throw new Error("hospital_id é obrigatório");
    const acc = await assertHospitalAccess(auth, body.hospital_id);
    if (!acc.ok) return unauthorizedResponse(acc, corsHeaders);
    if (!Array.isArray(body.items) || body.items.length === 0)
      throw new Error("items vazio");
    if (body.items.length > 5000) throw new Error("máximo 5.000 itens por chamada");

    const tolPct = body.tolerance_pct ?? 0.5;
    const tolAbs = body.tolerance_abs ?? 1.0;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Itens ----
    const items: ItemInput[] = body.items.map((it, idx) => buildItem(it, idx));

    // resolve company_document quando vier company_id
    const companyIds = Array.from(new Set(
      items.map((i) => i.company_id).filter(Boolean) as string[],
    ));
    if (companyIds.length > 0) {
      const { data: cs } = await supabase
        .from("companies").select("id,document,name").in("id", companyIds);
      const byId: Record<string, any> = {};
      for (const c of (cs ?? []) as any[]) byId[c.id] = c;
      for (const it of items) {
        if (it.company_id && byId[it.company_id]) {
          it.company_document = byId[it.company_id].document ?? null;
          it.company_name ??= byId[it.company_id].name ?? null;
        }
      }
    }

    // ---- Regras ----
    const { data: rulesHospRaw } = await supabase
      .from("rules").select(RULE_SELECT).eq("active", true).eq("hospital_id", body.hospital_id);
    const { data: rulesOtherRaw } = await supabase
      .from("rules").select(RULE_SELECT).eq("active", true).neq("hospital_id", body.hospital_id);

    const rulesHosp = (rulesHospRaw ?? []) as unknown as RuleInput[];
    const rulesOther = (rulesOtherRaw ?? []) as unknown as RuleInput[];
    await Promise.all([attachCalcs(supabase, rulesHosp), attachCalcs(supabase, rulesOther)]);

    // ---- Reference / exception tables ----
    const allRules = [...rulesHosp, ...rulesOther];
    const codes = Array.from(new Set(items.map((i) => (i.procedure_code ?? "").toString().trim()).filter(Boolean)));
    const refTableIds = Array.from(new Set([
      ...allRules.filter((r) => r.reference_table_id && (r.calculation_type === "tabela_diferenciada" || r.calculation_type === "tabela_referencia"))
        .map((r) => r.reference_table_id as string),
      ...allRules.flatMap((r) => (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
        .filter((c: any) => c.reference_table_id).map((c: any) => c.reference_table_id as string)),
    ]));
    const refValues: Record<string, Record<string, number>> = {};
    if (refTableIds.length > 0 && codes.length > 0) {
      const { data: refRows } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,amount,package_amount,role")
        .in("reference_table_id", refTableIds).in("code", codes);
      for (const row of (refRows ?? []) as any[]) {
        const tid = row.reference_table_id as string;
        const c = String(row.code ?? "").trim();
        const role = row.role
          ? row.role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
          : null;
        const amt = row.amount != null ? Number(row.amount) : (row.package_amount != null ? Number(row.package_amount) : null);
        if (amt == null || Number.isNaN(amt)) continue;
        const key = role ? `${c}|${role}` : c;
        (refValues[tid] ||= {})[key] = amt;
      }
    }
    const referenceLookup: ReferenceTableLookup = (tableId, c, role) => {
      const t = refValues[tableId]; if (!t) return null;
      const k = String(c).trim();
      if (role) {
        const rn = role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (t[`${k}|${rn}`] != null) return t[`${k}|${rn}`];
      }
      return t[k] ?? null;
    };

    const today = body.reference_date ?? new Date().toISOString().slice(0, 10);
    const linkedTableIds = Array.from(new Set(
      allRules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
    ));
    const exceptionTablesById: Record<string, { name: string; purpose: "sem_acordo" | "exclusao"; description: string | null }> = {};
    if (linkedTableIds.length > 0) {
      const { data: tables } = await supabase
        .from("reference_tables")
        .select("id,name,purpose,description,active,valid_from,valid_until")
        .in("id", linkedTableIds).in("purpose", ["sem_acordo", "exclusao"]).eq("active", true);
      for (const t of (tables ?? []) as any[]) {
        if (t.valid_from && t.valid_from > today) continue;
        if (t.valid_until && t.valid_until < today) continue;
        exceptionTablesById[t.id] = { name: t.name, purpose: t.purpose, description: t.description ?? null };
      }
    }
    const exceptionItemsByTable: Record<string, Record<string, { description: string | null }>> = {};
    if (linkedTableIds.length > 0 && codes.length > 0) {
      const { data: excItems } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,description")
        .in("reference_table_id", linkedTableIds).in("code", codes);
      for (const it of (excItems ?? []) as any[]) {
        const tid = it.reference_table_id as string;
        const c = String(it.code ?? "").trim();
        if (!tid || !c) continue;
        (exceptionItemsByTable[tid] ||= {})[c] = { description: it.description ?? null };
      }
    }
    const exceptionLookup: ExceptionTableLookup = (tableId, c) => {
      const t = exceptionTablesById[tableId]; if (!t) return null;
      const hit = exceptionItemsByTable[tableId]?.[String(c).trim()];
      if (!hit) return null;
      return { table_name: t.name, purpose: t.purpose, reason: hit.description ?? t.description ?? null };
    };

    const ctx: PaymentContext = {
      sectors: Array.from(new Set(items.map((i) => i.sector).filter(Boolean) as string[])),
      specialties: Array.from(new Set(items.map((i) => i.specialty).filter(Boolean) as string[])),
      payment_type: body.payment_type ?? null,
      reference_date: today,
    };
    (ctx as any).globalExceptionTableIds = [];

    // ---- Pass 1: regras do hospital ----
    const hospResults = analyzePaymentItems(items, rulesHosp, ctx, { referenceLookup, exceptionLookup });

    // ---- Pass 2: regras de outros hospitais (detecta vazamento) ----
    const otherResults = rulesOther.length > 0
      ? analyzePaymentItems(items, rulesOther, ctx, { referenceLookup, exceptionLookup })
      : [];

    const otherById = new Map(otherResults.map((r) => [r.item_id, r] as const));
    const otherRuleHospitalById: Record<string, string | null> = {};
    for (const r of rulesOther) otherRuleHospitalById[r.id] = (r as any).hospital_id ?? null;

    // ---- Classifica ----
    const rows = items.map((it, idx) => {
      const res = hospResults[idx];
      const other = otherById.get(it.id);
      const expected = res?.expected_amount ?? null;
      const paid = Number(it.gross_amount ?? 0);
      const diff = expected != null ? paid - expected : null;
      const diffPct = expected && expected !== 0 ? (Math.abs(diff!) / Math.abs(expected)) * 100 : null;

      const hasRule = !!res?.matched_rule_id;
      const leaks = (other && other.matched_rule_id && !hasRule)
        ? { rule_id: other.matched_rule_id, rule_name: other.matched_rule_name, hospital_id: otherRuleHospitalById[other.matched_rule_id] ?? null }
        : null;

      let status: "ok" | "sem_regra" | "divergente" | "hospital_errado";
      if (!hasRule && leaks) status = "hospital_errado";
      else if (!hasRule) status = "sem_regra";
      else {
        const divergePct = (diffPct ?? 0) > tolPct;
        const divergeAbs = Math.abs(diff ?? 0) > tolAbs;
        status = (divergePct && divergeAbs) ? "divergente" : "ok";
      }

      return {
        idx,
        item: {
          attendance_number: it.attendance_number,
          procedure_code: it.procedure_code,
          procedure_name: it.procedure_name,
          doctor_name: it.doctor_name,
          company_name: it.company_name,
          agreement_name: it.agreement_name,
          gross_amount: paid,
        },
        status,
        matched_rule_id: res?.matched_rule_id ?? null,
        matched_rule_name: res?.matched_rule_name ?? null,
        calculation_type_used: res?.calculation_type_used ?? null,
        expected_amount: expected,
        diff,
        diff_pct: diffPct,
        alerts: res?.alerts ?? [],
        leaked_rule: leaks,
      };
    });

    const summary = {
      total: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      sem_regra: rows.filter((r) => r.status === "sem_regra").length,
      divergente: rows.filter((r) => r.status === "divergente").length,
      hospital_errado: rows.filter((r) => r.status === "hospital_errado").length,
      rules_hospital: rulesHosp.length,
      rules_other: rulesOther.length,
      tolerance_pct: tolPct,
      tolerance_abs: tolAbs,
    };

    return new Response(JSON.stringify({ ok: true, summary, rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
