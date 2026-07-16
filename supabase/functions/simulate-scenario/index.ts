// simulate-scenario — executa o MOTOR REAL sobre uma lista de itens usando
// UMA regra sintética construída a partir do cenário informado pela UI do
// Simulador de Cenário (Relacionamento). Assim o Simulado usa exatamente a
// mesma lógica que roda no pagamento (fatores de função, via de acesso,
// piso, deflator/acréscimo, etc.), eliminando divergências causadas por
// heurísticas hardcoded no cliente.
//
// Entrada:
//   {
//     hospital_id: string,
//     scenario: {
//       calculation_type: "percentual_convenio" | "tabela_diferenciada",
//       convenio_percentage?: number,          // % convênio
//       reference_table_id?: string | null,     // tabela diferenciada
//       multiplier?: number,
//       deflator_pct?: number,
//       acrescimo_pct?: number,
//       apply_access_route?: boolean,           // default true
//       include_auxiliaries?: boolean,          // default true
//       aux_first_pct?: number | null,
//       aux_second_pct?: number | null,
//       instrumentador_pct?: number | null,
//     },
//     items: SimItem[]  // subset dos campos de payment_items
//   }
//
// Retorno: { ok, total_expected, per_item: [{ id, expected_amount, ... }], summary }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
  type ReferenceTableLookup,
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
  agreement_text?: string | null;
  doctor_name?: string | null;
  doctor_role?: string | null;
  access_route?: string | null;
  sector?: string | null;
  specialty?: string | null;
  attendance_number?: string | null;
  procedure_date?: string | null;
  gross_amount?: number | null;
  procedure_amount?: number | null;
  quantity?: number | null;
}

interface Scenario {
  calculation_type: "percentual_convenio" | "percentual_sobre_convenio" | "tabela_diferenciada";
  convenio_percentage?: number | null;
  reference_table_id?: string | null;
  multiplier?: number | null;
  deflator_pct?: number | null;
  acrescimo_pct?: number | null;
  apply_access_route?: boolean | null;
  include_auxiliaries?: boolean | null;
  aux_first_pct?: number | null;
  aux_second_pct?: number | null;
  instrumentador_pct?: number | null;
}

interface Body {
  hospital_id: string;
  scenario: Scenario;
  items: SimItem[];
  reference_date?: string | null;
}

function buildSyntheticRule(scenario: Scenario): RuleInput {
  const isTabela = scenario.calculation_type === "tabela_diferenciada";
  return {
    id: "sim-synth-rule",
    name: "Simulador de Cenário",
    rule_text: "Regra sintética construída pelo Simulador de Cenário",
    description: null,
    active: true,
    severity: "info",
    scope: "master",
    sectors: null,
    specialties: null,
    target_type: null,
    target_identifier: null,
    target_name: null,
    target_company_id: null,
    target_doctor_id: null,
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: scenario.calculation_type as any,
    convenio_percentage: isTabela ? null : Number(scenario.convenio_percentage ?? 100),
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    reference_table_id: isTabela ? (scenario.reference_table_id ?? null) : null,
    multiplier: isTabela ? Number(scenario.multiplier ?? 1) : null,
    deflator_pct: isTabela ? Number(scenario.deflator_pct ?? 0) : null,
    acrescimo_pct: isTabela ? Number(scenario.acrescimo_pct ?? 0) : null,
    repasse_pct: null,
    apply_access_route: scenario.apply_access_route ?? true,
    include_auxiliaries: scenario.include_auxiliaries ?? true,
    auxiliary_pct: null,
    aux_first_pct: scenario.aux_first_pct ?? null,
    aux_second_pct: scenario.aux_second_pct ?? null,
    instrumentador_pct: scenario.instrumentador_pct ?? null,
    group_company_links: null,
    group_doctors: null,
    bonus_amount: null,
    bonus_pct: null,
    target_amount: null,
    exclusion_reason: null,
    allows_authorized_exception: null,
    force_totalized: null,
    application_unit: null,
    agreement_text: null,
    agreement_aliases: null,
    agreement_match_mode: null,
    allowed_access_routes: null,
    exception_table_ids: null,
    calculations: null,
    limiar_alerta_tipo: null,
    limiar_alerta_valor: null,
    limiar_bloqueio_tipo: null,
    limiar_bloqueio_valor: null,
    prevent_external_fallback: false,
    special_case_filter: ["*"],
  } as RuleInput;
}

function buildItem(it: SimItem, idx: number): ItemInput {
  return {
    id: it.id ?? `sim-${idx}`,
    doctor_name: it.doctor_name ?? null,
    doctor_document: null,
    company_name: null,
    company_id: null,
    company_document: null,
    procedure_code: (it.procedure_code ?? "").toString().trim() || null,
    procedure_name: it.procedure_name ?? null,
    description: null,
    access_route: it.access_route ?? null,
    doctor_role: it.doctor_role ?? null,
    procedure_amount: it.procedure_amount ?? null,
    gross_amount: Number(it.gross_amount ?? 0),
    attendance_number: it.attendance_number ?? null,
    patient_name: null,
    procedure_date: it.procedure_date ?? null,
    quantity: it.quantity ?? 1,
    agreement_text: it.agreement_text ?? null,
    specialty: it.specialty ?? null,
    sector: it.sector ?? null,
    tipo_linha: null,
  } as ItemInput;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireInternalOrRole(req);
    if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

    const body = (await req.json()) as Body;
    if (!body?.hospital_id) throw new Error("hospital_id é obrigatório");
    const acc = await assertHospitalAccess(auth, body.hospital_id);
    if (!acc.ok) return unauthorizedResponse(acc, corsHeaders);
    if (!body.scenario) throw new Error("scenario é obrigatório");
    if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("items vazio");
    if (body.items.length > 20000) throw new Error("máximo 20.000 itens por chamada");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const items: ItemInput[] = body.items.map((it, idx) => buildItem(it, idx));
    const rule = buildSyntheticRule(body.scenario);

    // Reference lookup — carrega só os códigos presentes nos itens.
    const refValues: Record<string, number> = {};
    if (rule.calculation_type === "tabela_diferenciada" && rule.reference_table_id) {
      const codes = Array.from(new Set(
        items.map((i) => (i.procedure_code ?? "").toString().trim()).filter(Boolean),
      ));
      if (codes.length > 0) {
        const chunk = 500;
        for (let i = 0; i < codes.length; i += chunk) {
          const slice = codes.slice(i, i + chunk);
          const { data: refRows, error } = await supabase
            .from("reference_table_items")
            .select("code,amount,package_amount,role")
            .eq("reference_table_id", rule.reference_table_id)
            .in("code", slice);
          if (error) throw new Error(`reference_table_items: ${error.message}`);
          for (const row of (refRows ?? []) as any[]) {
            const c = String(row.code ?? "").trim();
            const role = row.role
              ? row.role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
              : null;
            const amt = row.amount != null ? Number(row.amount) : (row.package_amount != null ? Number(row.package_amount) : null);
            if (amt == null || Number.isNaN(amt)) continue;
            const key = role ? `${c}|${role}` : c;
            refValues[key] = amt;
          }
        }
      }
    }
    const referenceLookup: ReferenceTableLookup = (_tableId, code, role) => {
      const k = String(code).trim();
      if (role) {
        const rn = role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (refValues[`${k}|${rn}`] != null) return refValues[`${k}|${rn}`];
      }
      return refValues[k] ?? null;
    };

    const today = body.reference_date ?? new Date().toISOString().slice(0, 10);
    const ctx: PaymentContext = {
      sectors: Array.from(new Set(items.map((i) => i.sector).filter(Boolean) as string[])),
      specialties: Array.from(new Set(items.map((i) => i.specialty).filter(Boolean) as string[])),
      payment_type: null,
      reference_date: today,
    };
    (ctx as any).globalExceptionTableIds = [];

    const results = analyzePaymentItems(items, [rule], ctx, { referenceLookup });

    let totalExpected = 0;
    let itemsMatched = 0;
    let itemsWithoutMatch = 0;
    const perItem = results.map((r) => {
      const exp = r.expected_amount ?? 0;
      totalExpected += exp;
      if (r.matched_rule_id) itemsMatched += 1;
      else itemsWithoutMatch += 1;
      return {
        id: r.item_id,
        expected_amount: r.expected_amount ?? 0,
        matched: !!r.matched_rule_id,
        calculation_type_used: r.calculation_type_used ?? null,
        alerts: r.alerts ?? [],
      };
    });

    return new Response(JSON.stringify({
      ok: true,
      total_expected: totalExpected,
      summary: {
        total: items.length,
        matched: itemsMatched,
        without_match: itemsWithoutMatch,
        reference_codes_loaded: Object.keys(refValues).length,
      },
      per_item: perItem,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
