// simulate-rule — Simulador determinístico de regras
// Recebe um item de exemplo + contexto de pagamento e roda o motor real
// (mesmo `analyzeItem` usado em produção) sobre TODAS as regras ativas.
// Devolve o resultado com `selection_trace` (regras candidatas e descartes)
// e `calculation_breakdown` (cálculos avaliados na regra vencedora).
//
// Não persiste nada. Não envia para a IA. Não toca em payments/items.

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimInput {
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
  // contexto
  payment_type?: string | null;
  reference_date?: string | null;
  sectors?: string[] | null;
  specialties?: string[] | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as SimInput;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- 1. Item simulado ----
    const item: ItemInput = {
      id: "sim-1",
      doctor_name: body.doctor_name ?? null,
      doctor_document: body.doctor_document ?? null,
      company_name: body.company_name ?? null,
      company_id: body.company_id ?? null,
      company_document: null,
      procedure_code: (body.procedure_code ?? "").toString().trim() || null,
      procedure_name: body.procedure_name ?? null,
      description: null,
      access_route: body.access_route ?? null,
      doctor_role: body.doctor_role ?? null,
      procedure_amount: body.procedure_amount ?? null,
      gross_amount: Number(body.gross_amount ?? 0),
      attendance_number: body.attendance_number ?? null,
      patient_name: body.patient_name ?? null,
      procedure_date: body.procedure_date ?? null,
      quantity: body.quantity ?? 1,
      agreement_name: body.agreement_name ?? null,
      specialty: body.specialty ?? null,
      sector: body.sector ?? null,
      tipo_linha: body.tipo_linha ?? null,
    };

    // Resolve company_document quando company_id veio
    if (item.company_id) {
      const { data: c } = await supabase
        .from("companies")
        .select("document,name")
        .eq("id", item.company_id)
        .maybeSingle();
      if (c) {
        item.company_document = (c as any).document ?? null;
        item.company_name ??= (c as any).name ?? null;
      }
    }

    // ---- 2. Contexto ----
    const ctx: PaymentContext = {
      sectors: body.sectors ?? (item.sector ? [item.sector] : []),
      specialties: body.specialties ?? (item.specialty ? [item.specialty] : []),
      payment_type: body.payment_type ?? null,
      reference_date: body.reference_date ?? new Date().toISOString().slice(0, 10),
    };

    // ---- 3. Carrega regras ativas + cálculos ----
    const { data: rulesRaw, error: rulesErr } = await supabase
      .from("rules")
      .select(`
        id,name,rule_text,description,active,severity,scope,
        target_type,target_identifier,target_name,target_company_id,
        valid_from,valid_until,
        calculation_type,convenio_percentage,fixed_amount,package_amount,extras_codes,
        package_main_code,package_included_codes,package_visits_count,package_opinions_count,package_auxiliaries_included,package_subtype,
        reference_table_id,multiplier,deflator_pct,repasse_pct,acrescimo_pct,
        apply_access_route,include_auxiliaries,auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
        exclusion_reason,allows_authorized_exception,
        agreement_name,agreement_match_mode,
        exception_table_ids,
        group_company_links,group_doctors,
        bonus_amount,bonus_pct,target_amount,
        limiar_alerta_tipo, limiar_alerta_valor, limiar_bloqueio_tipo, limiar_bloqueio_valor,
        force_totalized
      `)
      .eq("active", true);

    if (rulesErr) {
      console.error("[simulate-rule] rules query error:", rulesErr);
      throw new Error(`Falha ao carregar regras: ${rulesErr.message}`);
    }

    const rules: RuleInput[] = (rulesRaw ?? []) as unknown as RuleInput[];

    if (rules.length > 0) {
      const ruleIds = rules.map((r) => r.id);
      const { data: calcRows } = await supabase
        .from("rule_calculations")
        .select(`
          id,rule_id,label,sort_order,calculation_type,
          time_mode,time_start,time_end,weekdays,includes_holidays,elective_mode,
          convenio_percentage,fixed_amount,
          package_amount,package_main_code,package_included_codes,package_visits_count,
          package_opinions_count,package_auxiliaries_included,package_subtype,extras_codes,
          reference_table_id,multiplier,deflator_pct,repasse_pct,acrescimo_pct,
          apply_access_route,include_auxiliaries,
          auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
          bonus_amount,bonus_pct,target_amount,allowed_access_routes,
          force_totalized,application_unit,sectors,specialties,
          procedure_codes,code_match_mode,doctor_roles,
          agreement_match_mode,agreement_aliases
        `)
        .in("rule_id", ruleIds)
        .order("sort_order", { ascending: true });
      const byRule: Record<string, any[]> = {};
      for (const c of (calcRows ?? []) as any[]) {
        (byRule[c.rule_id as string] ||= []).push(c);
      }
      for (const r of rules) {
        const list = byRule[r.id] ?? [];
        if (list.length > 0) (r as any).calculations = list;
      }
    }

    // ---- 4. Reference tables (apenas para o código do item) ----
    const code = (item.procedure_code ?? "").toString().trim();
    const refTableIds = Array.from(new Set([
      ...rules
        .filter((r) =>
          r.reference_table_id && (
            r.calculation_type === "tabela_diferenciada" ||
            r.calculation_type === "tabela_referencia"
          ),
        )
        .map((r) => r.reference_table_id as string),
      ...rules.flatMap((r) =>
        (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
          .filter((c: any) => c.reference_table_id)
          .map((c: any) => c.reference_table_id as string),
      ),
    ]));

    const refValues: Record<string, Record<string, number>> = {};
    if (refTableIds.length > 0 && code) {
      const { data: refRows } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,amount,package_amount,role")
        .in("reference_table_id", refTableIds)
        .eq("code", code);
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
      const t = refValues[tableId];
      if (!t) return null;
      const k = String(c).trim();
      if (role) {
        const rNorm = role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (t[`${k}|${rNorm}`] != null) return t[`${k}|${rNorm}`];
      }
      return t[k] ?? null;
    };

    // ---- 5. Exception tables vinculadas ----
    const linkedTableIds = Array.from(new Set(
      rules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
    ));
    const today = ctx.reference_date;
    const exceptionTablesById: Record<string, { name: string; purpose: "sem_acordo" | "exclusao"; description: string | null }> = {};
    const validGlobalIds: string[] = [];
    if (true) {
      const { data: tables } = await supabase
        .from("reference_tables")
        .select("id,name,purpose,description,active,valid_from,valid_until")
        .in("purpose", ["sem_acordo", "exclusao"])
        .eq("active", true);
      for (const t of (tables ?? []) as any[]) {
        if (t.valid_from && t.valid_from > today) continue;
        if (t.valid_until && t.valid_until < today) continue;
        exceptionTablesById[t.id] = { name: t.name, purpose: t.purpose, description: t.description ?? null };
        validGlobalIds.push(t.id);
      }
    }
    (ctx as any).globalExceptionTableIds = validGlobalIds;

    const allRelevantTableIds = Array.from(new Set([...linkedTableIds, ...validGlobalIds]));
    const exceptionItemsByTable: Record<string, Record<string, { description: string | null }>> = {};
    if (allRelevantTableIds.length > 0 && code) {
      const { data: excItems } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,description")
        .in("reference_table_id", allRelevantTableIds)
        .eq("code", code);
      for (const it of (excItems ?? []) as any[]) {
        const tid = it.reference_table_id as string;
        const c = String(it.code ?? "").trim();
        if (!tid || !c) continue;
        (exceptionItemsByTable[tid] ||= {})[c] = { description: it.description ?? null };
      }
    }
    const exceptionLookup: ExceptionTableLookup = (tableId, c) => {
      const t = exceptionTablesById[tableId];
      if (!t) return null;
      const hit = exceptionItemsByTable[tableId]?.[String(c).trim()];
      if (!hit) return null;
      return { table_name: t.name, purpose: t.purpose, reason: hit.description ?? t.description ?? null };
    };

    // ---- 6. Roda o motor real ----
    const results = analyzePaymentItems([item], rules, ctx, { referenceLookup, exceptionLookup });
    const result = results[0] ?? null;

    // ---- 7. Enriquecer trace com nomes das regras ----
    const ruleNameById: Record<string, string> = {};
    for (const r of rules) ruleNameById[r.id] = r.name;

    return new Response(JSON.stringify({
      ok: true,
      input: { item, ctx },
      result,
      rule_names: ruleNameById,
      total_active_rules: rules.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
