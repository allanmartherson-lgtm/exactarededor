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
  assistance_group_id?: string | null;
};

type Item = {
  id: string;
  payment_id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  procedure_date: string | null;
  doctor_name: string | null;
  doctor_document: string | null;
  patient_name: string | null;
  gross_amount: number | null;
  sector: string | null;
  company_id: string | null;
  company_name: string | null;
  doctor_role: string | null;
  access_route: string | null;
  raw_data: Record<string, unknown> | null;
};

type AssistanceGroup = {
  id: string;
  name: string;
  specialties: string[];
  active: boolean;
};

type Doctor = {
  id: string;
  full_name: string;
  crm: string | null;
  specialties: string[];
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

const normSpecialty = (s: string | null | undefined): string => {
  if (!s) return "";
  return s.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[.,;:]/g, "")
    .replace(/\s+/g, " ");
};

const isVisitaOuParecer = (name: string | null): boolean => {
  if (!name) return false;
  const n = normName(name);
  return n.includes("visita") || n.includes("parecer");
};

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
  if (params.compare_role) parts.push(normName(it.doctor_role ?? ""));
  if (params.compare_access_route) parts.push(normName(it.access_route ?? ""));
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
    params.compare_doctor || params.compare_patient || params.compare_role || params.compare_access_route;
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
  if (params.compare_role) reasonParts.push("função");
  if (params.compare_access_route) reasonParts.push("via de acesso");
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
      message: `Item duplicado: mesmo ${reason} do item de ${snapshot.patient_name ?? "paciente não informado"} — ${snapshot.procedure_name ?? "procedimento não informado"}${snapshot.procedure_code ? ` (${snapshot.procedure_code})` : ""}.`,
      conflicting_item_id: other.id,
      conflicting_item: snapshot,
      detected_at: now,
    });
    findingsByItem.set(target.id, list);
    hits++;
  }
  return hits;
}

function applySobreposicaoAssistencial(
  rule: ValidationRule,
  items: Item[],
  allDoctors: Doctor[],
  group: AssistanceGroup,
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
): { hits: number; unresolvedDoctors: Set<string> } {
  const params = (rule.params ?? {}) as Json;
  const unresolvedDoctors = new Set<string>();

  // Índices doutores
  const doctorByName = new Map<string, Doctor>();
  const doctorByCrm = new Map<string, Doctor>();
  for (const d of allDoctors) {
    if (d.full_name) doctorByName.set(normName(d.full_name), d);
    if (d.crm) doctorByCrm.set(d.crm.trim(), d);
  }

  const groupSpecSet = new Set(group.specialties.map(normSpecialty).filter(Boolean));
  if (groupSpecSet.size === 0) return { hits: 0, unresolvedDoctors };

  const isAfim = (doc: Doctor): boolean =>
    (doc.specialties ?? []).some((s) => groupSpecSet.has(normSpecialty(s)));

  // Itens elegíveis: visita ou parecer + doctor resolvido + afim
  type Elig = { item: Item; doctor: Doctor };
  const eligible: Elig[] = [];
  for (const it of items) {
    if (!isVisitaOuParecer(it.procedure_name)) continue;
    let doc: Doctor | undefined;
    if (it.doctor_document && it.doctor_document.trim()) {
      doc = doctorByCrm.get(it.doctor_document.trim());
    }
    if (!doc && it.doctor_name) {
      doc = doctorByName.get(normName(it.doctor_name));
    }
    if (!doc) {
      if (it.doctor_name) unresolvedDoctors.add(it.doctor_name);
      continue;
    }
    if (!isAfim(doc)) continue;
    eligible.push({ item: it, doctor: doc });
  }

  // Agrupar
  const groups = new Map<string, Elig[]>();
  for (const e of eligible) {
    const parts: string[] = [];
    if (params.compare_patient) parts.push(normName(e.item.patient_name ?? ""));
    if (params.compare_date) parts.push((e.item.procedure_date ?? "").slice(0, 10));
    if (params.compare_attendance) parts.push(e.item.attendance_number ?? "");
    const key = parts.join("|");
    if (!key.replaceAll("|", "")) continue;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const now = new Date().toISOString();
  let hits = 0;

  for (const grp of groups.values()) {
    const distinctDocs = new Set(grp.map((e) => normName(e.doctor.full_name)));
    if (distinctDocs.size < 2) continue;

    const doctorNames = Array.from(new Set(grp.map((e) => e.doctor.full_name)));
    const patientName = grp[0].item.patient_name ?? "paciente não informado";
    const dateStr = (grp[0].item.procedure_date ?? "").slice(0, 10);

    for (const e of grp) {
      const other = grp.find((x) => normName(x.doctor.full_name) !== normName(e.doctor.full_name))!;
      const snapshot: ConflictingItemSnapshot = {
        attendance_number: other.item.attendance_number,
        patient_name: getPatient(other.item),
        procedure_code: other.item.procedure_code,
        procedure_name: other.item.procedure_name,
        doctor_name: other.item.doctor_name,
        procedure_date: other.item.procedure_date,
        company_name: other.item.company_name,
        payment_id: other.item.payment_id,
        payment_reference: paymentReference,
      };
      const list = findingsByItem.get(e.item.id) ?? [];
      list.push({
        rule_id: rule.id,
        rule_name: rule.name,
        kind: rule.kind,
        severity: rule.severity,
        action: rule.action,
        message: `Sobreposição assistencial: ${patientName} foi atendido em ${dateStr} por ${distinctDocs.size} médicos afins do grupo '${group.name}' (${doctorNames.join(", ")}).`,
        conflicting_item_id: other.item.id,
        conflicting_item: snapshot,
        detected_at: now,
      });
      findingsByItem.set(e.item.id, list);
      hits++;
    }
  }

  return { hits, unresolvedDoctors };
}

function applyDuplicidadeAtendimento(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
): number {
  const params = (rule.params ?? {}) as Json;
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const parts: string[] = [];
    if (params.compare_attendance) parts.push(it.attendance_number ?? "");
    if (params.compare_code) parts.push(it.procedure_code ?? "");
    if (params.compare_date) parts.push((it.procedure_date ?? "").slice(0, 10));
    if (params.compare_patient) parts.push(normName(it.patient_name ?? ""));
    if (!params.allow_different_doctors) parts.push(normName(it.doctor_name ?? ""));
    const key = parts.join("|");
    if (!key.replaceAll("|", "")) continue;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const now = new Date().toISOString();
  let hits = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first, ...dupes] = group;
    for (const dupe of dupes) {
      const list = findingsByItem.get(dupe.id) ?? [];
      const snapshot: ConflictingItemSnapshot = {
        attendance_number: first.attendance_number,
        patient_name: getPatient(first),
        procedure_code: first.procedure_code,
        procedure_name: first.procedure_name,
        doctor_name: first.doctor_name,
        procedure_date: first.procedure_date,
        company_name: first.company_name,
        payment_id: first.payment_id,
        payment_reference: paymentReference,
      };
      list.push({
        rule_id: rule.id,
        rule_name: rule.name,
        kind: rule.kind,
        severity: rule.severity,
        action: rule.action,
        message: `Duplicidade por atendimento: procedimento ${dupe.procedure_code ?? dupe.procedure_name ?? "—"} cobrado ${group.length}× no atendimento ${dupe.attendance_number ?? "—"}.`,
        conflicting_item_id: first.id,
        conflicting_item: snapshot,
        detected_at: now,
      });
      findingsByItem.set(dupe.id, list);
      hits++;
    }
  }
  return hits;
}

function applyParecerVirouCirurgia(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
): number {
  const params = (rule.params ?? {}) as Json;
  const prazoHoras = Number(params.prazo_horas ?? 48);
  const mesmoMedico = !!params.mesmo_medico;

  const isParecer = (it: Item) => {
    const n = normName(it.procedure_name ?? "");
    return n.includes("parecer") || n.includes("consultoria") || n.includes("interconsulta");
  };
  const isCirurgia = (it: Item) => {
    const n = normName(it.procedure_name ?? "");
    const s = normName(it.sector ?? "");
    return n.includes("cirurg") || s.includes("cirurg") || s.includes("hemodin");
  };

  const cirurgiasByAtt = new Map<string, Item[]>();
  for (const it of items) {
    if (!isCirurgia(it) || !it.attendance_number) continue;
    const arr = cirurgiasByAtt.get(it.attendance_number) ?? [];
    arr.push(it);
    cirurgiasByAtt.set(it.attendance_number, arr);
  }

  const now = new Date().toISOString();
  let hits = 0;

  for (const it of items) {
    if (!isParecer(it) || !it.attendance_number) continue;
    const cirurgias = cirurgiasByAtt.get(it.attendance_number) ?? [];
    for (const cir of cirurgias) {
      if (mesmoMedico && normName(it.doctor_name ?? "") !== normName(cir.doctor_name ?? "")) continue;
      const dtParecer = it.procedure_date ? new Date(it.procedure_date).getTime() : null;
      const dtCirurgia = cir.procedure_date ? new Date(cir.procedure_date).getTime() : null;
      if (dtParecer && dtCirurgia) {
        const diffHoras = Math.abs(dtCirurgia - dtParecer) / 3_600_000;
        if (diffHoras > prazoHoras) continue;
      }
      const list = findingsByItem.get(it.id) ?? [];
      const snapshot: ConflictingItemSnapshot = {
        attendance_number: cir.attendance_number,
        patient_name: getPatient(cir),
        procedure_code: cir.procedure_code,
        procedure_name: cir.procedure_name,
        doctor_name: cir.doctor_name,
        procedure_date: cir.procedure_date,
        company_name: cir.company_name,
        payment_id: cir.payment_id,
        payment_reference: paymentReference,
      };
      list.push({
        rule_id: rule.id,
        rule_name: rule.name,
        kind: rule.kind,
        severity: rule.severity,
        action: rule.action,
        message: `Parecer absorvido pela cirurgia: ${it.procedure_name ?? "parecer"} seguido de cirurgia (${cir.procedure_name ?? "—"}) no atendimento ${it.attendance_number} dentro de ${prazoHoras}h — não pagar separadamente.`,
        conflicting_item_id: cir.id,
        conflicting_item: snapshot,
        detected_at: now,
      });
      findingsByItem.set(it.id, list);
      hits++;
      break;
    }
  }
  return hits;
}

function applyRestricaoContratual(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
): number {
  const params = (rule.params ?? {}) as Json;
  const horaInicio = String(params.hora_inicio ?? "08:00");
  const horaFim = String(params.hora_fim ?? "17:59");
  const diasSemana: number[] = Array.isArray(params.dias_semana) ? params.dias_semana as number[] : [1,2,3,4,5];
  const codigosRestritos: string[] = Array.isArray(params.codigos_restritos) ? params.codigos_restritos as string[] : [];
  const observacao = String(params.observacao_analista ?? "");

  const [hIni, mIni] = horaInicio.split(":").map(Number);
  const [hFim, mFim] = horaFim.split(":").map(Number);
  const minIni = (hIni * 60) + mIni;
  const minFim = (hFim * 60) + mFim;

  const now = new Date().toISOString();
  let hits = 0;

  for (const it of items) {
    if (!it.procedure_date) continue;
    if (codigosRestritos.length > 0 && it.procedure_code && !codigosRestritos.includes(it.procedure_code)) continue;

    const dt = new Date(it.procedure_date);
    const diaSemana = dt.getDay();
    const minItem = dt.getHours() * 60 + dt.getMinutes();

    const diaOk = diasSemana.includes(diaSemana);
    const horaOk = minItem >= minIni && minItem <= minFim;
    if (!diaOk || !horaOk) continue;

    const list = findingsByItem.get(it.id) ?? [];
    list.push({
      rule_id: rule.id,
      rule_name: rule.name,
      kind: rule.kind,
      severity: rule.severity,
      action: rule.action,
      message: `Restrição contratual: procedimento ${it.procedure_code ?? it.procedure_name ?? "—"} em ${it.procedure_date} dentro do horário restrito (${horaInicio}–${horaFim}).${observacao ? " " + observacao : ""}`,
      detected_at: now,
    });
    findingsByItem.set(it.id, list);
    hits++;
  }
  return hits;
}

async function applyOutlierValor(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const params = (rule.params ?? {}) as Json;
  const criterion = String(params.criterion ?? "percentil");
  const percentil = Number(params.percentile ?? 95);
  const pctAboveMean = Number(params.pct_above_mean ?? 50) / 100;
  const meanMultiplier = Number(params.mean_multiplier ?? 2);
  const minHistory = Number(params.min_history ?? 10);

  const codes = [...new Set(items.map(i => i.procedure_code).filter(Boolean))];
  if (codes.length === 0) return 0;

  const { data: history } = await supabase
    .from("payment_items")
    .select("procedure_code, gross_amount")
    .in("procedure_code", codes as string[])
    .not("gross_amount", "is", null)
    .limit(10000);

  const byCode = new Map<string, number[]>();
  for (const h of (history ?? []) as Array<{ procedure_code: string | null; gross_amount: number | null }>) {
    if (!h.procedure_code || h.gross_amount == null) continue;
    const arr = byCode.get(h.procedure_code) ?? [];
    arr.push(Number(h.gross_amount));
    byCode.set(h.procedure_code, arr);
  }

  const now = new Date().toISOString();
  let hits = 0;

  for (const it of items) {
    if (!it.procedure_code || it.gross_amount == null) continue;
    const hist = byCode.get(it.procedure_code) ?? [];
    if (hist.length < minHistory) continue;

    const sorted = [...hist].sort((a, b) => a - b);
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const valor = Number(it.gross_amount);

    let isOutlier = false;
    let threshold = 0;

    if (criterion === "percentil") {
      const idx = Math.floor((percentil / 100) * sorted.length);
      threshold = sorted[Math.min(idx, sorted.length - 1)];
      isOutlier = valor > threshold;
    } else if (criterion === "media_pct") {
      threshold = mean * (1 + pctAboveMean);
      isOutlier = valor > threshold;
    } else if (criterion === "multiplo_media") {
      threshold = mean * meanMultiplier;
      isOutlier = valor > threshold;
    }

    if (!isOutlier) continue;

    const list = findingsByItem.get(it.id) ?? [];
    list.push({
      rule_id: rule.id,
      rule_name: rule.name,
      kind: rule.kind,
      severity: rule.severity,
      action: rule.action,
      message: `Valor fora do padrão histórico: ${it.procedure_code} cobrado R$ ${valor.toFixed(2)} vs. referência histórica R$ ${threshold.toFixed(2)} (${hist.length} registros).`,
      detected_at: now,
    });
    findingsByItem.set(it.id, list);
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

    // 1. Carrega lote (para filtros de escopo), itens, regras, médicos e grupos
    const [
      { data: payment, error: payErr },
      { data: itemsRaw, error: itErr },
      { data: rulesRaw, error: rulesErr },
      { data: doctorsRaw, error: docErr },
      { data: groupsRaw, error: grpErr },
    ] = await Promise.all([
      supabase.from("payments").select("id, payment_type, sectors, reference").eq("id", payment_id).single(),
      supabase
        .from("payment_items")
        .select("id, payment_id, attendance_number, procedure_code, procedure_name, procedure_date, doctor_name, doctor_document, patient_name, gross_amount, sector, company_id, company_name, doctor_role, access_route, raw_data")
        .eq("payment_id", payment_id)
        .limit(20000),
      supabase.from("validation_rules").select("*").eq("active", true),
      (async () => {
        const all: Doctor[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("doctors")
            .select("id, full_name, crm, specialties")
            .eq("active", true)
            .range(from, from + PAGE - 1);
          if (error) return { data: null as any, error };
          if (!data || data.length === 0) break;
          all.push(...(data as Doctor[]));
          if (data.length < PAGE) break;
        }
        return { data: all, error: null };
      })(),
      supabase.from("assistance_groups").select("id, name, specialties, active").eq("active", true),
    ]);
    if (payErr || !payment) throw payErr ?? new Error("payment not found");
    if (itErr) throw itErr;
    if (rulesErr) throw rulesErr;
    if (docErr) throw docErr;
    if (grpErr) throw grpErr;

    const items = (itemsRaw ?? []) as Item[];
    const rules = (rulesRaw ?? []) as ValidationRule[];
    const allDoctors = (doctorsRaw ?? []) as Doctor[];
    const groupsById = new Map<string, AssistanceGroup>();
    for (const g of (groupsRaw ?? []) as AssistanceGroup[]) groupsById.set(g.id, g);
    
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
    const unresolvedByRule: Record<string, string[]> = {};

    for (const rule of rules) {
      if (!ruleAppliesToPayment(rule, payment as any)) {
        skippedRules.push({ id: rule.id, name: rule.name, reason: "out_of_scope" });
        continue;
      }
      if (rule.kind === "duplicidade_exata") {
        const hits = applyDuplicidadeExata(rule, items, findingsByItem, paymentReference);
        totalHits += hits;
        appliedRules.push(rule.name);
      } else if (rule.kind === "sobreposicao_assistencial") {
        const groupId = rule.assistance_group_id;
        if (!groupId) {
          skippedRules.push({ id: rule.id, name: rule.name, reason: "no_assistance_group" });
          continue;
        }
        const group = groupsById.get(groupId);
        if (!group || !group.active) {
          skippedRules.push({ id: rule.id, name: rule.name, reason: "assistance_group_inactive_or_missing" });
          continue;
        }
        const result = applySobreposicaoAssistencial(rule, items, allDoctors, group, findingsByItem, paymentReference);
        totalHits += result.hits;
        if (result.unresolvedDoctors.size > 0) {
          unresolvedByRule[rule.name] = Array.from(result.unresolvedDoctors);
        }
        appliedRules.push(rule.name);
      } else if (rule.kind === "duplicidade_atendimento") {
        const hits = applyDuplicidadeAtendimento(rule, items, findingsByItem, paymentReference);
        totalHits += hits;
        appliedRules.push(rule.name);
      } else if (rule.kind === "parecer_virou_cirurgia") {
        const hits = applyParecerVirouCirurgia(rule, items, findingsByItem, paymentReference);
        totalHits += hits;
        appliedRules.push(rule.name);
      } else if (rule.kind === "restricao_contratual") {
        const hits = applyRestricaoContratual(rule, items, findingsByItem);
        totalHits += hits;
        appliedRules.push(rule.name);
      } else if (rule.kind === "outlier_valor") {
        const hits = await applyOutlierValor(rule, items, findingsByItem, supabase);
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
        unresolved_doctors_by_rule: unresolvedByRule,
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
