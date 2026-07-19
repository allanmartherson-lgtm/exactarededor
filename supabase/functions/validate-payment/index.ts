// validate-payment
// Motor de validação assistencial. Lê regras ativas em `validation_rules` e
// aplica nos itens do lote. Roda SOB DEMANDA (botão na UI), independente de
// analyze-payment / orchestrate-analysis. Nunca toca em ai_findings nem em
// ai_status — grava resultados apenas em payment_items.validation_findings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
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

// TUSS típicos de parecer/visita hospitalar:
//   10102019 = Visita hospitalar (paciente internado, por dia)
//   10102027 = Consulta médica em pronto-socorro
//   10103015 = Avaliação para procedimentos cirúrgicos
//   10103082 = Parecer / consultoria médica em internação
const PARECER_VISITA_TUSS = new Set([
  "10102019", "10102027", "10103015", "10103082",
]);

const isVisitaOuParecer = (
  name: string | null,
  code?: string | null,
  _paymentType?: string | null,
): boolean => {
  // Eligibilidade estrita por item (TUSS ou nome).
  // Tipo de lançamento do LOTE não entra aqui — lotes de parecer/visita já
  // embutem o TUSS automaticamente na importação, então o filtro por código
  // cobre esses casos sem inflar eligibilidade de itens não-assistenciais
  // (ex.: EEG num lote misto).
  if (code) {
    const c = code.replace(/\D/g, "");
    if (PARECER_VISITA_TUSS.has(c)) return true;
  }
  if (name) {
    const n = normName(name);
    if (n.includes("visita") || n.includes("parecer") || n.includes("interconsulta") || n.includes("consultoria")) {
      return true;
    }
  }
  return false;
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


// Normaliza params de regras antigas (duplicidade_exata / duplicidade_atendimento)
// para o formato unificado duplicidade_lancamento.
function normalizeDupParams(rule: ValidationRule): {
  compare_attendance: boolean; compare_patient: boolean; compare_date: boolean;
  compare_code: boolean; compare_role: boolean; compare_access_route: boolean;
  doctor_mode: "same" | "any" | "different"; window_days: number;
} {
  const p = (rule.params ?? {}) as Json;
  const dm = (p.doctor_mode as string) ??
    (p.compare_doctor === false || p.allow_different_doctors === true ? "any" : "same");
  return {
    compare_attendance: p.compare_attendance !== false,
    compare_patient: p.compare_patient !== false,
    compare_date: p.compare_date !== false,
    compare_code: p.compare_code !== false,
    compare_role: !!p.compare_role,
    compare_access_route: !!p.compare_access_route,
    doctor_mode: (dm === "any" || dm === "different" ? dm : "same") as "same" | "any" | "different",
    window_days: typeof p.window_days === "number" && p.window_days > 0 ? p.window_days : 0,
  };
}

function applyDuplicidadeLancamento(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
  externalItems: Item[] = [],
  externalRefById: Map<string, string | null> = new Map(),
  currentPaymentId: string | null = null,
): number {
  const params = normalizeDupParams(rule);
  const anyFieldSelected =
    params.compare_attendance || params.compare_code || params.compare_patient ||
    params.compare_role || params.compare_access_route || params.compare_date;
  if (!anyFieldSelected) return 0;

  // Chave estável (sem data quando há janela em dias)
  const useDateInKey = params.compare_date && params.window_days === 0;
  const keyOf = (it: Item) => {
    const parts: string[] = [];
    if (params.compare_attendance) parts.push(it.attendance_number ?? "");
    if (params.compare_code) parts.push(it.procedure_code ?? "");
    if (useDateInKey) parts.push((it.procedure_date ?? "").slice(0, 10));
    if (params.compare_patient) parts.push(normName(it.patient_name ?? ""));
    if (params.compare_role) parts.push(normName(it.doctor_role ?? ""));
    if (params.compare_access_route) parts.push(normName(it.access_route ?? ""));
    if (params.doctor_mode === "same") parts.push(normName(it.doctor_name ?? ""));
    return parts.join("|");
  };

  const buckets = new Map<string, Item[]>();
  const pushBucket = (it: Item) => {
    const key = keyOf(it);
    if (!key.replaceAll("|", "")) return;
    const arr = buckets.get(key) ?? [];
    arr.push(it);
    buckets.set(key, arr);
  };
  for (const it of items) pushBucket(it);
  for (const it of externalItems) pushBucket(it);

  const reasonParts: string[] = [];
  if (params.compare_attendance) reasonParts.push("atendimento");
  if (params.compare_code) reasonParts.push("código");
  if (params.compare_date) reasonParts.push(params.window_days > 0 ? `janela de ${params.window_days}d` : "data");
  if (params.compare_patient) reasonParts.push("paciente");
  if (params.compare_role) reasonParts.push("função");
  if (params.compare_access_route) reasonParts.push("via de acesso");
  if (params.doctor_mode === "same") reasonParts.push("mesmo médico");
  if (params.doctor_mode === "different") reasonParts.push("médicos distintos");
  const reason = reasonParts.join(" + ");
  const now = new Date().toISOString();

  let hits = 0;
  const dayMs = 86400000;
  const isInternal = (it: Item) => currentPaymentId == null || it.payment_id === currentPaymentId;

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    // Aplica modo de médico (different)
    if (params.doctor_mode === "different") {
      const distinct = new Set(bucket.map((i) => normName(i.doctor_name ?? "")).filter(Boolean));
      if (distinct.size < 2) continue;
    }

    // Janela em dias: agrupa em sub-clusters pela proximidade de procedure_date
    const subClusters: Item[][] = [];
    if (params.window_days > 0 && params.compare_date) {
      const sorted = [...bucket]
        .map((i) => ({ i, t: i.procedure_date ? new Date(i.procedure_date).getTime() : NaN }))
        .filter((x) => Number.isFinite(x.t))
        .sort((a, b) => a.t - b.t);
      let current: { i: Item; t: number }[] = [];
      for (const node of sorted) {
        if (current.length === 0 || node.t - current[current.length - 1].t <= params.window_days * dayMs) {
          current.push(node);
        } else {
          if (current.length >= 2) subClusters.push(current.map((x) => x.i));
          current = [node];
        }
      }
      if (current.length >= 2) subClusters.push(current.map((x) => x.i));
    } else {
      subClusters.push(bucket);
    }

    for (const cluster of subClusters) {
      if (cluster.length < 2) continue;

      const internals = cluster.filter(isInternal);
      if (internals.length === 0) continue;
      const externals = cluster.filter((it) => !isInternal(it));

      // Pares a marcar: (dupe, partner). Em cross-batch, cada interno aponta
      // para o primeiro externo. Em duplicidade intra-lote, mantém o
      // comportamento clássico: primeiro item é âncora, demais ficam flagged.
      const pairs: Array<{ dupe: Item; partner: Item; crossBatch: boolean }> = [];
      if (externals.length > 0) {
        const partner = externals[0];
        for (const dupe of internals) {
          if (dupe.id === partner.id) continue;
          pairs.push({ dupe, partner, crossBatch: true });
        }
      } else {
        const [first, ...rest] = internals;
        for (const dupe of rest) pairs.push({ dupe, partner: first, crossBatch: false });
      }

      for (const { dupe, partner, crossBatch } of pairs) {
        const snapshot: ConflictingItemSnapshot = {
          attendance_number: partner.attendance_number,
          patient_name: getPatient(partner),
          procedure_code: partner.procedure_code,
          procedure_name: partner.procedure_name,
          doctor_name: partner.doctor_name,
          procedure_date: partner.procedure_date,
          company_name: partner.company_name,
          payment_id: partner.payment_id,
          payment_reference: crossBatch
            ? (externalRefById.get(partner.payment_id) ?? null)
            : paymentReference,
        };
        const list = findingsByItem.get(dupe.id) ?? [];
        list.push({
          rule_id: rule.id,
          rule_name: rule.name,
          kind: rule.kind,
          severity: rule.severity,
          action: rule.action,
          message: crossBatch
            ? `Duplicidade entre lotes: mesmo ${reason} (lote ${snapshot.payment_reference ?? "anterior"}).`
            : `Duplicidade de lançamento: mesmo ${reason}.`,
          conflicting_item_id: partner.id,
          conflicting_item: snapshot,
          detected_at: now,
        });
        findingsByItem.set(dupe.id, list);
        hits++;
      }
    }
  }
  return hits;
}




function applySobreposicaoAssistencial(
  rule: ValidationRule,
  items: Item[],
  allDoctors: Doctor[],
  group: AssistanceGroup | null,
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
  paymentTypeForElig: string | null,
  externalItems: Item[] = [],
  externalRefById: Map<string, string | null> = new Map(),
  currentPaymentId: string | null = null,
  allAliases: Array<{ doctor_id: string; alias_normalized: string }> = [],
): { hits: number; unresolvedDoctors: Set<string> } {

  const params = (rule.params ?? {}) as Json;
  const unresolvedDoctors = new Set<string>();

  const doctorByName = new Map<string, Doctor>();
  const doctorByCrm = new Map<string, Doctor>();
  const doctorsById = new Map<string, Doctor>();
  for (const d of allDoctors) {
    doctorsById.set(d.id, d);
    if (d.full_name) doctorByName.set(normName(d.full_name), d);
    if (d.crm) doctorByCrm.set(d.crm.trim(), d);
  }
  for (const a of allAliases) {
    if (!a.alias_normalized) continue;
    if (doctorByName.has(a.alias_normalized)) continue; // don't overwrite canonical
    const doc = doctorsById.get(a.doctor_id);
    if (doc) doctorByName.set(a.alias_normalized, doc);
  }


  // Com grupo: filtra por especialidades afins. Sem grupo: aceita qualquer
  // combinação de especialidades distintas (modo "múltiplas especialidades").
  const groupSpecSet = group
    ? new Set(group.specialties.map(normSpecialty).filter(Boolean))
    : null;
  if (groupSpecSet && groupSpecSet.size === 0) return { hits: 0, unresolvedDoctors };

  const isAfim = (doc: Doctor): boolean => {
    if (!groupSpecSet) return true;
    return (doc.specialties ?? []).some((s) => groupSpecSet.has(normSpecialty(s)));
  };

  // Params do modo "sem grupo"
  const specialtyMatch = (params.specialty_match === "any" ? "any" : "primary") as "primary" | "any";
  const minDistinct = Math.max(2, Number(params.min_distinct_specialties) || 2);
  const excludedSet = new Set<string>(
    Array.isArray(params.excluded_specialties)
      ? (params.excluded_specialties as string[]).map(normSpecialty).filter(Boolean)
      : [],
  );

  const docSpecialties = (doc: Doctor): string[] => {
    const all = (doc.specialties ?? []).map(normSpecialty).filter(Boolean);
    const picked = specialtyMatch === "primary" ? all.slice(0, 1) : all;
    return picked.filter((s) => !excludedSet.has(s));
  };

  type Elig = { item: Item; doctor: Doctor; specialty: string; specialties: string[]; external: boolean };
  const eligible: Elig[] = [];
  const collectEligible = (it: Item, external: boolean) => {
    if (!isVisitaOuParecer(it.procedure_name, it.procedure_code, paymentTypeForElig)) return;
    let doc: Doctor | undefined;
    if (it.doctor_document && it.doctor_document.trim()) {
      doc = doctorByCrm.get(it.doctor_document.trim());
    }
    if (!doc && it.doctor_name) {
      doc = doctorByName.get(normName(it.doctor_name));
    }
    if (!doc) {
      if (!external && it.doctor_name) unresolvedDoctors.add(it.doctor_name);
      return;
    }
    if (!isAfim(doc)) return;
    const specs = groupSpecSet ? (doc.specialties ?? []).map(normSpecialty).filter(Boolean) : docSpecialties(doc);
    if (!groupSpecSet && specs.length === 0) return;
    eligible.push({ item: it, doctor: doc, specialty: specs[0] ?? "", specialties: specs, external });
  };
  for (const it of items) collectEligible(it, false);
  for (const it of externalItems) collectEligible(it, true);




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
    const unionSpecs = new Set<string>();
    for (const e of grp) for (const s of e.specialties) unionSpecs.add(s);
    if (groupSpecSet) {
      const distinctDocs = new Set(grp.map((e) => normName(e.doctor.full_name)));
      if (distinctDocs.size < 2) continue;
    } else {
      if (unionSpecs.size < minDistinct) continue;
    }

    // Precisa ter pelo menos 1 item interno para emitir finding (não polui
    // outros lotes com alertas gerados na validação deste lote).
    const internos = grp.filter((e) => !e.external);
    if (internos.length === 0) continue;

    const doctorNames = Array.from(new Set(grp.map((e) => e.doctor.full_name)));
    const specialtiesList = Array.from(unionSpecs);

    const patientName = grp[0].item.patient_name ?? "paciente não informado";
    const dateStr = (grp[0].item.procedure_date ?? "").slice(0, 10);
    const contextLabel = group ? `do grupo '${group.name}'` : `de especialidades distintas`;
    const detailLabel = group
      ? `${doctorNames.join(", ")}`
      : `${specialtiesList.join(" + ")} — ${doctorNames.join(", ")}`;

    for (const e of internos) {
      const other =
        grp.find((x) => normName(x.doctor.full_name) !== normName(e.doctor.full_name)) ??
        grp.find((x) => x.specialty !== e.specialty);
      if (!other) continue;
      const otherRef = other.external
        ? (externalRefById.get(other.item.payment_id ?? "") ?? null)
        : paymentReference;
      const snapshot: ConflictingItemSnapshot = {
        attendance_number: other.item.attendance_number,
        patient_name: getPatient(other.item),
        procedure_code: other.item.procedure_code,
        procedure_name: other.item.procedure_name,
        doctor_name: other.item.doctor_name,
        procedure_date: other.item.procedure_date,
        company_name: other.item.company_name,
        payment_id: other.item.payment_id,
        payment_reference: otherRef,
      };
      const crossTag = other.external ? ` (lote ${otherRef ?? "externo"})` : "";
      const list = findingsByItem.get(e.item.id) ?? [];
      list.push({
        rule_id: rule.id,
        rule_name: rule.name,
        kind: rule.kind,
        severity: rule.severity,
        action: rule.action,
        message: `Sobreposição assistencial: ${patientName} foi atendido em ${dateStr} por médicos ${contextLabel} (${detailLabel})${crossTag}.`,
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


// Legados: aliases para a função unificada.



function applyParecerVirouCirurgia(
  rule: ValidationRule,
  items: Item[],
  findingsByItem: Map<string, Finding[]>,
  paymentReference: string | null,
  paymentType: string | null,
): number {
  const params = (rule.params ?? {}) as Json;
  const prazoHoras = Number(params.prazo_horas ?? 48);
  const mesmoMedico = !!params.mesmo_medico;

  // Item é parecer/visita? (mesma heurística do filtro de elegibilidade)
  const isParecer = (it: Item) =>
    isVisitaOuParecer(it.procedure_name, it.procedure_code, paymentType);

  // Cirurgia REAL: nome/sector contém "cirurg"/"hemodin" E NÃO é parecer/visita.
  // Sem essa exclusão, "Parecer - Neurocirurgia" casa como cirurgia (contém "cirurg")
  // e gera falso positivo — o parecer "vira cirurgia" contra si mesmo.
  const isCirurgia = (it: Item) => {
    if (isParecer(it)) return false;
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

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const body = await req.json();
    const payment_id = body?.payment_id;
    // scope: "batch" (default, só o lote) | "cross" (varre outros lotes na janela)
    const scope: "batch" | "cross" = body?.scope === "cross" ? "cross" : "batch";
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Multi-tenant: lê primeiro o hospital_id do pagamento para filtrar validation_rules
    // pela mesma unidade. Sem esse filtro, regras de outras unidades vazariam.
    const { data: paymentMeta, error: payMetaErr } = await supabase
      .from("payments")
      .select("hospital_id, analysis_mode")
      .eq("id", payment_id)
      .single();
    if (payMetaErr || !paymentMeta) throw payMetaErr ?? new Error("payment not found");
    // Defesa em profundidade: validação assistencial não roda em confecção.
    // Em confecção o motor apenas calcula repasse — não há fluxo de aprovação
    // assistencial, e gross_amount está nulo (não há base contra a qual validar).
    if ((paymentMeta as any).analysis_mode === "confeccao") {
      return new Response(JSON.stringify({
        ok: true, skipped: true, reason: "confeccao_mode",
        message: "Validação assistencial não se aplica ao modo confecção.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const paymentHospitalId = (paymentMeta as any).hospital_id as string | null;
    if (!paymentHospitalId) throw new Error("payment sem hospital_id — não é possível validar com segurança multi-tenant");


    // 1. Carrega lote (para filtros de escopo), itens, regras, médicos e grupos
    const [
      { data: payment, error: payErr },
      { data: itemsRaw, error: itErr },
      { data: rulesRaw, error: rulesErr },
      { data: doctorsRaw, error: docErr },
      { data: groupsRaw, error: grpErr },
      { data: aliasesRaw, error: aliasErr },
    ] = await Promise.all([
      supabase.from("payments").select("id, payment_type, sectors, reference").eq("id", payment_id).single(),
      supabase
        .from("payment_items")
        .select("id, payment_id, attendance_number, procedure_code, procedure_name, procedure_date, doctor_name, doctor_document, patient_name, gross_amount, sector, company_id, company_name, doctor_role, access_route, raw_data")
        .eq("payment_id", payment_id)
        .limit(20000),
      supabase.from("validation_rules").select("*").eq("active", true).eq("hospital_id", paymentHospitalId),
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
      (async () => {
        const all: Array<{ doctor_id: string; alias_normalized: string }> = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("doctor_aliases")
            .select("doctor_id, alias_normalized")
            .range(from, from + PAGE - 1);
          if (error) return { data: null as any, error };
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
        return { data: all, error: null };
      })(),
    ]);
    if (payErr || !payment) throw payErr ?? new Error("payment not found");
    if (itErr) throw itErr;
    if (rulesErr) throw rulesErr;
    if (docErr) throw docErr;
    if (grpErr) throw grpErr;
    if (aliasErr) throw aliasErr;


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

    // 2b. Cross-batch: carrega itens de OUTROS lotes do mesmo hospital dentro
    // de uma janela ao redor das datas dos procedimentos deste lote. Serve
    // para detectar duplicidades entre lotes (mesmo paciente + atendimento +
    // data em competências diferentes). Janela = maior window_days entre
    // regras de duplicidade ativas, default 30 dias.
    const dupRules = rules.filter((r) =>
      r.kind === "duplicidade_lancamento" || r.kind === "duplicidade_exata" || r.kind === "duplicidade_atendimento",
    );
    const crossWindowDays = Math.max(
      30,
      ...dupRules.map((r) => normalizeDupParams(r).window_days || 0),
    );
    let externalItems: Item[] = [];
    const externalRefById = new Map<string, string | null>();
    const hasSobreposicao = rules.some((r) => r.kind === "sobreposicao_assistencial");
    // scope="batch" (default) NUNCA carrega itens de outros lotes — o usuário
    // pediu explicitamente varredura limitada ao lote atual. Só scope="cross"
    // ativa a busca cross-batch (mais pesada e que gera findings entre lotes).
    const loadExternals = items.length > 0
      && (dupRules.length > 0 || hasSobreposicao)
      && scope === "cross";
    if (loadExternals) {

      const dates = items.map((i) => i.procedure_date).filter((d): d is string => !!d);
      if (dates.length > 0) {
        const dayMs = 86400000;
        const minT = Math.min(...dates.map((d) => new Date(d).getTime())) - crossWindowDays * dayMs;
        const maxT = Math.max(...dates.map((d) => new Date(d).getTime())) + crossWindowDays * dayMs;
        const fromIso = new Date(minT).toISOString().slice(0, 10);
        const toIso = new Date(maxT).toISOString().slice(0, 10);

        // Pagamentos elegíveis: mesmo hospital, lote diferente, não em confecção.
        const { data: otherPayments } = await supabase
          .from("payments")
          .select("id, reference")
          .eq("hospital_id", paymentHospitalId)
          .neq("id", payment_id)
          .neq("analysis_mode", "confeccao")
          .limit(2000);
        const otherIds = (otherPayments ?? []).map((p: any) => p.id as string);
        for (const p of (otherPayments ?? []) as any[]) externalRefById.set(p.id, p.reference ?? null);

        if (otherIds.length > 0) {
          // Paginação defensiva — outros lotes podem somar muitos itens.
          // PostgREST corta em 1000 linhas por request; PAGE precisa ser <=1000
          // senão chunk.length < PAGE encerra o loop na primeira página e
          // silenciosamente perde os itens seguintes.
          const PAGE = 1000;
          for (let from = 0; ; from += PAGE) {
            const { data: chunk, error: extErr } = await supabase
              .from("payment_items")
              .select("id, payment_id, attendance_number, procedure_code, procedure_name, procedure_date, doctor_name, doctor_document, patient_name, gross_amount, sector, company_id, company_name, doctor_role, access_route, raw_data")
              .in("payment_id", otherIds)
              .gte("procedure_date", fromIso)
              .lte("procedure_date", toIso)
              .range(from, from + PAGE - 1);
            if (extErr) { console.error("[validate-payment] external items fetch failed", extErr); break; }
            if (!chunk || chunk.length === 0) break;
            externalItems.push(...(chunk as Item[]));
            if (chunk.length < PAGE) break;
            if (externalItems.length > 200000) break; // hard cap defensivo
          }
        }
      }
    }
    console.log(`[validate-payment] cross-batch loaded externalItems=${externalItems.length} window=${crossWindowDays}d`);

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
      if (
        rule.kind === "duplicidade_lancamento" ||
        rule.kind === "duplicidade_exata" ||
        rule.kind === "duplicidade_atendimento"
      ) {
        const hits = applyDuplicidadeLancamento(
          rule, items, findingsByItem, paymentReference,
          externalItems, externalRefById, payment_id,
        );
        totalHits += hits;
        appliedRules.push(rule.name);

      } else if (rule.kind === "sobreposicao_assistencial") {
        const groupId = rule.assistance_group_id;
        let group: AssistanceGroup | null = null;
        if (groupId) {
          const g = groupsById.get(groupId);
          if (!g || !g.active) {
            skippedRules.push({ id: rule.id, name: rule.name, reason: "assistance_group_inactive_or_missing" });
            continue;
          }
          group = g;
        }
        const extForOverlap = externalItems;
        const result = applySobreposicaoAssistencial(
          rule, items, allDoctors, group, findingsByItem, paymentReference,
          (payment as any).payment_type ?? null,
          extForOverlap, externalRefById, payment_id, aliasesRaw ?? [],
        );


        totalHits += result.hits;
        if (result.unresolvedDoctors.size > 0) {
          unresolvedByRule[rule.name] = Array.from(result.unresolvedDoctors);
        }
        appliedRules.push(rule.name);

      } else if (rule.kind === "parecer_virou_cirurgia") {
        const hits = applyParecerVirouCirurgia(rule, items, findingsByItem, paymentReference, (payment as any).payment_type ?? null);
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
        scope,
        external_items_scanned: externalItems.length,
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
