// validate-payment
// Motor de validação assistencial. Lê regras ativas em `validation_rules` e
// aplica nos itens do lote. Roda SOB DEMANDA (botão na UI), independente de
// analyze-payment / orchestrate-analysis. Nunca toca em ai_findings nem em
// ai_status — grava resultados apenas em payment_items.validation_findings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Json = Record<string, unknown>;

type ValidationRule = {
  id: string;
  name: string;
  active: boolean;
  severity: string;
  kind: string;
  action: string;
  scope_global: boolean;
  sectors: string[];
  payment_types: string[];
  company_ids: string[];
  params: Json;
};

type Item = {
  id: string;
  payment_id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  procedure_date: string | null;
  doctor_name: string | null;
  patient_name: string | null;
  gross_amount: number | null;
  sector: string | null;
  company_id: string | null;
  company_name: string | null;
  raw_data: Record<string, unknown> | null;
};

type ConflictingItemSnapshot = {
  attendance_number: string | null;
  patient_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  doctor_name: string | null;
  procedure_date: string | null;
  company_name: string | null;
  payment_id: string;
  payment_reference: string | null;
};

type Finding = {
  rule_id: string;
  rule_name: string;
  kind: string;
  severity: string;
  action: string;
  message: string;
  conflicting_item_id?: string;
  conflicting_item?: ConflictingItemSnapshot;
  detected_at: string;
};

const normName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

const normKey = (s: string) =>
  s.toString().toLowerCase().trim().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[\s_\-./]+/g, "");

function rawPick(raw: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!raw) return null;
  const wanted = keys.map(normKey);
  for (const rk of Object.keys(raw)) {
    if (wanted.includes(normKey(rk))) {
      const v = raw[rk];
      if (v != null && String(v).trim() !== "") return String(v);
    }
  }
  return null;
}

const PATIENT_ALIASES = ["paciente", "nome paciente", "nm paciente", "nome do paciente"];

const getPatient = (it: Item): string | null =>
  (it.patient_name && it.patient_name.trim() !== "") ? it.patient_name : rawPick(it.raw_data, PATIENT_ALIASES);

function ruleAppliesToPayment(
  rule: ValidationRule,
  payment: { payment_type: string | null; sectors: string[] | null },
): boolean {
  if (rule.scope_global) return true;
  const sectors = rule.sectors ?? [];
  const ptypes = rule.payment_types ?? [];
  if (sectors.length > 0) {
    const ps = payment.sectors ?? [];
    if (!sectors.some((s) => ps.includes(s))) return false;
  }
  if (ptypes.length > 0) {
    if (!payment.payment_type || !ptypes.includes(payment.payment_type)) return false;
  }
  return true;
}

function buildDupKey(it: Item, params: Json): string {
  const parts: string[] = [];
  if (params.compare_attendance) parts.push(it.attendance_number ?? "");
  if (params.compare_code) parts.push(it.procedure_code ?? "");
  if (params.compare_date) parts.push((it.procedure_date ?? "").slice(0, 10));
  if (params.compare_doctor) parts.push(normName(it.doctor_name ?? ""));
  if (params.compare_patient) parts.push(normName(it.patient_name ?? ""));
  return parts.join("|");
}

function applyDuplicidadeExata(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
): number {
  const params = (rule.params ?? {}) as Json;
  const anySelected =
    params.compare_attendance || params.compare_code || params.compare_date ||
    params.compare_doctor || params.compare_patient;
  if (!anySelected) return 0;

  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = buildDupKey(it, params);
    if (!key.replaceAll("|", "")) continue; // chave totalmente vazia → ignora
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  const reasonParts: string[] = [];
  if (params.compare_attendance) reasonParts.push("atendimento");
  if (params.compare_code) reasonParts.push("código");
  if (params.compare_date) reasonParts.push("data");
  if (params.compare_doctor) reasonParts.push("médico");
  if (params.compare_patient) reasonParts.push("paciente");
  const reason = reasonParts.join(" + ");
  const now = new Date().toISOString();

  let hits = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.gross_amount ?? 0) - (b.gross_amount ?? 0));
    const target = sorted[0].gross_amount === sorted[1].gross_amount ? group[1] : sorted[0];
    const other = group.find((x) => x.id !== target.id)!;
    const list = findingsByItem.get(target.id) ?? [];
    const snapshot: ConflictingItemSnapshot = {
      attendance_number: other.attendance_number,
      patient_name: getPatient(other),
      procedure_code: other.procedure_code,
      procedure_name: other.procedure_name,
      doctor_name: other.doctor_name,
      procedure_date: other.procedure_date,
      company_name: other.company_name,
      payment_id: other.payment_id,
      payment_reference: paymentReference,
    };
    list.push({
      rule_id: rule.id,
      rule_name: rule.name,
      kind: rule.kind,
      severity: rule.severity,
      action: rule.action,
      message: `Item duplicado com item ${other.id} (mesmo ${reason}).`,
      conflicting_item_id: other.id,
      conflicting_item: snapshot,
      detected_at: now,
    });
    findingsByItem.set(target.id, list);
    hits++;
  }
  return hits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Carrega lote (para filtros de escopo) e itens
    const [{ data: payment, error: payErr }, { data: itemsRaw, error: itErr }, { data: rulesRaw, error: rulesErr }] =
      await Promise.all([
        supabase.from("payments").select("id, payment_type, sectors, reference").eq("id", payment_id).single(),
        supabase
          .from("payment_items")
          .select("id, payment_id, attendance_number, procedure_code, procedure_name, procedure_date, doctor_name, patient_name, gross_amount, sector, company_id, company_name, raw_data")
          .eq("payment_id", payment_id)
          .limit(20000),
        supabase.from("validation_rules").select("*").eq("active", true),
      ]);
    if (payErr || !payment) throw payErr ?? new Error("payment not found");
    if (itErr) throw itErr;
    if (rulesErr) throw rulesErr;

    const items = (itemsRaw ?? []) as Item[];
    const rules = (rulesRaw ?? []) as ValidationRule[];
    const paymentReference = (payment as any).reference ?? null;

    // 2. Idempotência: zera validation_findings de todos os itens do lote
    await supabase
      .from("payment_items")
      .update({ validation_findings: [] })
      .eq("payment_id", payment_id);

    // 3. Aplica regras
    const findingsByItem = new Map<string, Finding[]>();
    let totalHits = 0;
    const appliedRules: string[] = [];
    const skippedRules: { id: string; name: string; reason: string }[] = [];

    for (const rule of rules) {
      if (!ruleAppliesToPayment(rule, payment as any)) {
        skippedRules.push({ id: rule.id, name: rule.name, reason: "out_of_scope" });
        continue;
      }
      if (rule.kind === "duplicidade_exata") {
        const hits = applyDuplicidadeExata(rule, items, findingsByItem, paymentReference);
        totalHits += hits;
        appliedRules.push(rule.name);
      } else {
        skippedRules.push({ id: rule.id, name: rule.name, reason: `kind_not_implemented:${rule.kind}` });
      }
    }

    // 4. Persiste findings (apenas itens que receberam algo)
    const updates = Array.from(findingsByItem.entries());
    for (const [itemId, findings] of updates) {
      const { error: upErr } = await supabase
        .from("payment_items")
        .update({ validation_findings: findings })
        .eq("id", itemId);
      if (upErr) console.error("[validate-payment] update item failed", itemId, upErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        payment_id,
        items_scanned: items.length,
        rules_applied: appliedRules,
        rules_skipped: skippedRules,
        items_flagged: updates.length,
        total_findings: totalHits,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[validate-payment] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
