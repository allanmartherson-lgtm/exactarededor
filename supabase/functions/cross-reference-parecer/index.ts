// cross-reference-parecer
// Motor de classificação Parecer × Visita (Bloco 1 — reforma 2026-07-13).
//
// Regra determinística:
//   Por (hospital_id + attendance_number + empresa + especialidade) — com
//   fallback company_id → norm(company_name) — o primeiro contato AMBÍGUO
//   (histórico global de outros lotes + lote atual) é o único candidato a
//   parecer. Todo o resto do grupo é visita. O relatório do Tasy só
//   VALIDA o candidato — nunca classifica.
//
// Após o cruzamento, dispara reanálise via dispatch-payment-analysis com
// skip_parecer_cross_ref=true para o motor recomputar as regras com o
// tipo já correto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const onlyDigits = (s: any) => String(s ?? "").replace(/\D+/g, "");

function crmDigits(crm: string | null) {
  if (!crm) return "";
  return onlyDigits(crm);
}

// Compara apenas a porção YYYY-MM-DD em UTC, ignorando hora/timezone.
export function sameDayUtc(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(+da) || isNaN(+db)) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

// Data de referência do parecer = data da RESPOSTA. Se vazia, não cai para
// a solicitação (senão confirmaria parecer ainda não respondido).
export function matchesParecerDate(row: any, procedureDate: string | null) {
  return sameDayUtc(row.dt_resposta_parecer, procedureDate);
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  return d.toISOString().slice(0, 10);
}

const PROTECTED_SOURCES = new Set(["manual", "company_override", "base_tipo"]);
type EvidenceValue = "confirmed" | "not_found" | "no_report" | "unverified" | "not_applicable";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const { payment_id, trigger_reanalysis = true, _background } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Guard multi-tenant: caller precisa ter vínculo com hospital do pagamento.
    const { data: __xrefPayRow } = await supabase
      .from("payments")
      .select("hospital_id")
      .eq("id", payment_id)
      .maybeSingle();
    const __xrefHospitalId = (__xrefPayRow as any)?.hospital_id ?? null;
    if (!_auth.is_internal && !assertCallerHospital(_auth, __xrefHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Executa em background para evitar IDLE_TIMEOUT (150s) do caller.
    if (!_background) {
      const bgPromise = fetch(`${SUPABASE_URL}/functions/v1/cross-reference-parecer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ payment_id, trigger_reanalysis, _background: true }),
      }).catch((e) => console.warn("[cross-reference-parecer] bg dispatch failed", e));
      // @ts-ignore — EdgeRuntime existe no runtime do Supabase
      try { EdgeRuntime.waitUntil(bgPromise); } catch { /* noop */ }
      return new Response(
        JSON.stringify({ ok: true, accepted: true, background: true }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tipo do lote (parecer_adulto por padrão) e tipo Visita alvo.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("has_mixed_parecer, mixed_parecer_item_type_id")
      .eq("id", payment_id)
      .maybeSingle();
    const isMixed = !!(paymentRow as any)?.has_mixed_parecer;
    const mixedParecerTypeId = (paymentRow as any)?.mixed_parecer_item_type_id ?? null;

    const { data: defaultParecerType } = await supabase
      .from("item_types")
      .select("id")
      .eq("code", "parecer_adulto")
      .maybeSingle();
    const defaultParecerItemTypeId = (defaultParecerType as any)?.id ?? null;
    const lotePaymentTypeId = isMixed ? mixedParecerTypeId : defaultParecerItemTypeId;

    const { data: visitaType } = await supabase
      .from("item_types")
      .select("id")
      .eq("code", "visita")
      .maybeSingle();
    const visitaPaymentTypeId = (visitaType as any)?.id ?? null;

    // Conjunto de TUSS ambíguos (parecer/visita/consulta) e ids de tipos
    // ambíguos para o filtro do lookback histórico.
    const { data: ambTypes } = await supabase
      .from("item_types")
      .select("id, code, tuss_default, tuss_codes_extra");
    const ambiguousTussSet = new Set<string>();
    const ambiguousTypeIds = new Set<string>();
    for (const t of (ambTypes ?? []) as any[]) {
      const code = String(t.code ?? "").toLowerCase();
      const isAmb = code.startsWith("parecer") || code === "visita" || code === "consulta";
      if (!isAmb) continue;
      if (t.id) ambiguousTypeIds.add(String(t.id));
      if (t.tuss_default) ambiguousTussSet.add(String(t.tuss_default).trim());
      for (const c of (t.tuss_codes_extra ?? []) as string[]) {
        if (c) ambiguousTussSet.add(String(c).trim());
      }
    }

    if (isMixed) {
      console.log(
        `[cross-reference-parecer] mixed_mode=on parecerType=${mixedParecerTypeId} ambiguousTuss=${[...ambiguousTussSet].join(",")}`,
      );
    }

    // Relatórios do lote (gate — sem relatório, 400).
    const { data: reports, error: repErr } = await supabase
      .from("payment_parecer_reports")
      .select("id, period_start, period_end")
      .eq("payment_id", payment_id);
    if (repErr) throw repErr;
    const hasReport = (reports ?? []).length > 0;

    if (!hasReport) {
      return new Response(
        JSON.stringify({
          error: "Nenhum relatório de parecer importado para este lote.",
          code: "no_report",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Linhas do relatório (paginadas).
    const allRows: any[] = [];
    {
      const ids = reports!.map((r) => r.id);
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error } = await supabase
          .from("payment_parecer_report_rows")
          .select(
            "id, report_id, atendimento, medico_resposta, medico_resposta_crm, dt_solic_parecer, dt_resposta_parecer, situacao",
          )
          .in("report_id", ids)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        allRows.push(...(page ?? []));
        if (!page || page.length < pageSize) break;
      }
    }

    if (allRows.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Relatório de parecer importado, mas sem linhas gravadas. Reimporte o arquivo — o cabeçalho está vazio.",
          code: "empty_report",
          reports: reports?.length ?? 0,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Índices para validação do candidato (atendimento + médico → linhas).
    const byAttendCrm = new Map<string, any[]>();
    const byAttendName = new Map<string, any[]>();
    for (const r of allRows) {
      const att = onlyDigits(r.atendimento);
      if (!att) continue;
      const cd = crmDigits(r.medico_resposta_crm);
      if (cd) {
        const k = `${att}|${cd}`;
        (byAttendCrm.get(k) ?? byAttendCrm.set(k, []).get(k))!.push(r);
      }
      const nm = norm(r.medico_resposta);
      if (nm) {
        const k = `${att}|${nm}`;
        (byAttendName.get(k) ?? byAttendName.set(k, []).get(k))!.push(r);
      }
    }

    // Itens do lote (paginados).
    const items: any[] = [];
    {
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error } = await supabase
          .from("payment_items")
          .select(
            "id, attendance_number, doctor_name, doctor_id, procedure_date, procedure_code, item_type_id, item_type_source, specialty, convenio_slug, hospital_id, company_id, company_name, is_cancelled, created_at",
          )
          .eq("payment_id", payment_id)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        items.push(...(page ?? []));
        if (!page || page.length < pageSize) break;
      }
    }

    // CRMs dos médicos referenciados (para validação por médico+atend).
    const doctorIds = Array.from(new Set(items.map((i) => i.doctor_id).filter(Boolean)));
    const crmByDoctor = new Map<string, string>();
    if (doctorIds.length) {
      const { data: docs } = await supabase
        .from("doctors")
        .select("id, crm, crm_uf")
        .in("id", doctorIds);
      for (const d of (docs ?? []) as any[]) {
        if (d.crm) crmByDoctor.set(d.id, onlyDigits(d.crm));
      }
    }

    // ==== Filtro de candidatos ====
    // Em lote misto: só TUSS ambíguos. Fora de lote misto: todos os itens
    // são candidatos (payment_type do lote inteiro é parecer).
    // Itens cancelados sempre ignorados.
    // Itens protegidos entram no fluxo APENAS para receber parecer_evidence
    // informativo — nunca trocam item_type_id.
    type CandidateItem = typeof items[number];
    const candidates: CandidateItem[] = [];
    let skippedCancelled = 0;
    let skippedNonAmbiguousTuss = 0;
    let protectedItems: CandidateItem[] = [];
    for (const it of items) {
      if (it.is_cancelled) { skippedCancelled++; continue; }
      if (isMixed) {
        const code = String(it.procedure_code ?? "").trim();
        if (!code || !ambiguousTussSet.has(code)) { skippedNonAmbiguousTuss++; continue; }
      }
      if (PROTECTED_SOURCES.has(it.item_type_source ?? "")) {
        protectedItems.push(it);
        // Protegido também entra para receber evidência, mas em grupo
        // separado — ele não define candidato para os outros.
      }
      candidates.push(it);
    }

    // ==== Chave de agrupamento (com fallback) ====
    type GroupKey = string; // hosp|att|empresa|spec
    const groupOf = new Map<string, GroupKey>(); // item.id → key
    const groupsMap = new Map<GroupKey, CandidateItem[]>();
    const skippedNoKey: string[] = [];

    for (const it of candidates) {
      const hospKey = it.hospital_id;
      const attKey = onlyDigits(it.attendance_number);
      const specKey = norm(it.specialty);
      const empresaKey = it.company_id ?? (norm(it.company_name) || null);
      if (!hospKey || !attKey || !specKey || !empresaKey) {
        skippedNoKey.push(it.id);
        continue;
      }
      const key = `${hospKey}|${attKey}|${empresaKey}|${specKey}`;
      groupOf.set(it.id, key);
      const list = groupsMap.get(key) ?? [];
      list.push(it);
      groupsMap.set(key, list);
    }

    // Alerta: >10% dos candidatos sem chave.
    if (candidates.length > 0 && skippedNoKey.length / candidates.length > 0.1) {
      console.warn(
        `[cross-reference-parecer] skipped_no_key > 10% (${skippedNoKey.length}/${candidates.length}). sample=${skippedNoKey.slice(0, 20).join(",")}`,
      );
    }

    // ==== Lookback histórico EM BATCH ====
    // Coleta attendances únicos por hospital, quebra em chunks de 200,
    // e traz TODAS as linhas históricas de outros lotes com TUSS/tipo
    // ambíguo. Match final por grupo é feito em memória.
    type HistRow = {
      id: string;
      payment_id: string;
      hospital_id: string;
      company_id: string | null;
      company_name: string | null;
      specialty: string | null;
      attendance_number: string | null;
      procedure_code: string | null;
      procedure_date: string | null;
      created_at: string | null;
      item_type_id: string | null;
    };
    const CHUNK = 200;
    const historyByGroup = new Map<GroupKey, HistRow[]>();

    // Agrupa attendances por hospital.
    const attsByHospital = new Map<string, Set<string>>();
    for (const it of candidates) {
      const att = onlyDigits(it.attendance_number);
      if (!att || !it.hospital_id) continue;
      const set = attsByHospital.get(it.hospital_id) ?? new Set<string>();
      set.add(it.attendance_number); // valor bruto — coluna não tem versão só-dígitos
      attsByHospital.set(it.hospital_id, set);
    }

    const ambTypeIdsArr = [...ambiguousTypeIds];
    const ambTussArr = [...ambiguousTussSet];

    for (const [hospId, attSet] of attsByHospital.entries()) {
      const attArr = [...attSet];
      for (let i = 0; i < attArr.length; i += CHUNK) {
        const chunk = attArr.slice(i, i + CHUNK);
        let q = supabase
          .from("payment_items")
          .select(
            "id, payment_id, hospital_id, company_id, company_name, specialty, attendance_number, procedure_code, procedure_date, created_at, item_type_id",
          )
          .eq("hospital_id", hospId)
          .in("attendance_number", chunk)
          .neq("payment_id", payment_id)
          .eq("is_cancelled", false);
        // Filtro tipo/TUSS ambíguo. Ambos podem estar vazios em ambientes
        // sem cadastro de item_types — nesse caso não filtra (comportamento
        // conservador, mais itens seguem para o match em memória).
        if (ambTypeIdsArr.length > 0 && ambTussArr.length > 0) {
          const inList = ambTypeIdsArr.map((id) => `"${id}"`).join(",");
          const tussList = ambTussArr.map((c) => `"${c}"`).join(",");
          q = q.or(`item_type_id.in.(${inList}),procedure_code.in.(${tussList})`);
        } else if (ambTypeIdsArr.length > 0) {
          q = q.in("item_type_id", ambTypeIdsArr);
        } else if (ambTussArr.length > 0) {
          q = q.in("procedure_code", ambTussArr);
        }
        const { data: page, error } = await q;
        if (error) {
          console.warn(`[cross-reference-parecer] lookback chunk fail hosp=${hospId}`, error.message);
          continue;
        }
        for (const row of (page ?? []) as HistRow[]) {
          const attKey = onlyDigits(row.attendance_number);
          const specKey = norm(row.specialty);
          const empresaKey = row.company_id ?? (norm(row.company_name) || null);
          if (!attKey || !specKey || !empresaKey) continue;
          const key = `${row.hospital_id}|${attKey}|${empresaKey}|${specKey}`;
          if (!groupsMap.has(key)) continue; // só nos interessa se casa com um grupo do lote atual
          const list = historyByGroup.get(key) ?? [];
          list.push(row);
          historyByGroup.set(key, list);
        }
      }
    }

    console.log(
      `[cross-reference-parecer] groups=${groupsMap.size} candidates=${candidates.length} skippedNoKey=${skippedNoKey.length} skippedCancelled=${skippedCancelled} skippedNonAmbiguousTuss=${skippedNonAmbiguousTuss} lookback_hospitals=${attsByHospital.size} lookback_matched_groups=${historyByGroup.size}`,
    );

    // ==== Decisão por grupo ====
    // Para cada item: define role ('candidate_parecer' | 'visita' | 'protected')
    // e evidence + weak.
    type Decision = {
      evidence: EvidenceValue;
      weak: boolean;
      roleParecer: boolean; // candidato virou parecer (tipo)
      roleVisita: boolean;  // item vira visita
      reportRowId: string | null; // hit.id do relatório Tasy quando confirmed
    };
    const decisionById = new Map<string, Decision>();

    // Protegidos (não trocam tipo). Evidência: se candidato eleito, marcaremos
    // depois; por default entram como 'not_applicable' (informativo).
    // Vamos preencher junto do loop principal do grupo abaixo.

    for (const [key, groupItems] of groupsMap.entries()) {
      // Ordena candidatos do lote por procedure_date asc, tie-break created_at asc.
      const ordered = [...groupItems].sort((a, b) => {
        const da = a.procedure_date ? Date.parse(a.procedure_date) : Infinity;
        const db = b.procedure_date ? Date.parse(b.procedure_date) : Infinity;
        if (da !== db) return da - db;
        const ca = a.created_at ? Date.parse(a.created_at) : 0;
        const cb = b.created_at ? Date.parse(b.created_at) : 0;
        return ca - cb;
      });
      const first = ordered[0];
      const firstDay = dayKey(first?.procedure_date ?? null);

      // Histórico do grupo (só itens de OUTROS lotes, já filtrado).
      const hist = historyByGroup.get(key) ?? [];
      let priorStrict = false; // histórico com data ESTRITAMENTE anterior
      let priorSameDay = false; // histórico no mesmo dia do candidato atual
      for (const h of hist) {
        const hDay = dayKey(h.procedure_date);
        if (!hDay || !firstDay) continue;
        if (hDay < firstDay) { priorStrict = true; break; }
        if (hDay === firstDay) priorSameDay = true;
      }

      if (priorStrict) {
        // Todo o grupo vira visita.
        for (const it of ordered) {
          decisionById.set(it.id, {
            evidence: "not_applicable",
            weak: false,
            roleParecer: false,
            roleVisita: true,
            reportRowId: null,
          });
        }
        continue;
      }

      // Sem histórico estritamente anterior: o candidato é o primeiro do lote.
      // Empate interno (mesma data que o 2º) → weak=true.
      let internalTie = false;
      if (ordered.length >= 2) {
        const d0 = dayKey(ordered[0].procedure_date);
        const d1 = dayKey(ordered[1].procedure_date);
        if (d0 && d1 && d0 === d1) internalTie = true;
      }

      // Validação do candidato contra o relatório do Tasy.
      const att = onlyDigits(first.attendance_number);
      const cd = crmByDoctor.get(first.doctor_id ?? "") ?? "";
      const nm = norm(first.doctor_name);
      let hit: any = null;
      let weakFromValidation = false;
      if (att && cd) {
        const list = byAttendCrm.get(`${att}|${cd}`) ?? [];
        hit = list.find((r) =>
          matchesParecerDate(r, first.procedure_date) &&
          String(r.situacao ?? "").toLowerCase().includes("com parecer"),
        ) ?? list.find((r) => matchesParecerDate(r, first.procedure_date)) ?? null;
      }
      if (!hit && att && nm) {
        const list = byAttendName.get(`${att}|${nm}`) ?? [];
        hit = list.find((r) => matchesParecerDate(r, first.procedure_date)) ?? null;
        if (hit) weakFromValidation = true;
      }

      // Regra do empate entre lotes: mesmo que o Tasy confirme, se há
      // histórico no MESMO dia, marcamos como 'unverified' + weak — não
      // dá para saber a ordem.
      let candidateEvidence: EvidenceValue;
      let candidateWeak: boolean;
      let candidateReportRowId: string | null = null;
      if (priorSameDay) {
        candidateEvidence = "unverified";
        candidateWeak = true;
      } else if (hit) {
        candidateEvidence = "confirmed";
        candidateWeak = weakFromValidation || internalTie;
        candidateReportRowId = hit.id ?? null;
      } else {
        candidateEvidence = "unverified";
        candidateWeak = true;
      }

      decisionById.set(first.id, {
        evidence: candidateEvidence,
        weak: candidateWeak,
        roleParecer: true,
        roleVisita: false,
        reportRowId: candidateReportRowId,
      });
      for (let i = 1; i < ordered.length; i++) {
        decisionById.set(ordered[i].id, {
          evidence: "not_applicable",
          weak: false,
          roleParecer: false,
          roleVisita: true,
          reportRowId: null,
        });
      }
    }

    // ==== Aplica patches em batches agrupados ====
    const now = new Date().toISOString();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    let parecerConfirmed = 0;
    let parecerUnverified = 0;
    let visitas = 0;
    let protectedKept = 0;
    let notFoundLegacy = 0; // manteremos 0 para compatibilidade; UI antiga lê essa chave

    type Group = { patch: Record<string, any>; ids: string[] };
    const groups = new Map<string, Group>();

    function enqueue(id: string, patch: Record<string, any>) {
      const key = JSON.stringify(patch);
      let g = groups.get(key);
      if (!g) { g = { patch, ids: [] }; groups.set(key, g); }
      g.ids.push(id);
    }

    for (const it of items) {
      if (it.is_cancelled) continue;
      const isProtected = PROTECTED_SOURCES.has(it.item_type_source ?? "");
      const decision = decisionById.get(it.id);

      if (!decision) {
        // Sem decisão: item pulado (skippedNoKey ou fora de ambíguo em lote misto).
        // Ainda assim gravamos evidência informativa 'not_applicable' quando
        // ele foi de fato descartado como candidato ambíguo.
        // Mas para não sobrescrever itens não relacionados, só marcamos se
        // ele estava no conjunto `candidates` (participou do filtro).
        continue;
      }

      const patch: Record<string, any> = {
        parecer_evidence: decision.evidence,
        parecer_evidence_weak: decision.weak,
        parecer_checked_at: now,
        parecer_report_row_id: decision.reportRowId,
      };

      if (isProtected) {
        // Nunca troca item_type_id. Só evidência informativa.
        protectedKept++;
        enqueue(it.id, patch);
        continue;
      }

      if (!lotePaymentTypeId || !visitaPaymentTypeId) {
        // Sem tipos resolvidos, ainda assim grava evidência coerente.
        enqueue(it.id, patch);
        continue;
      }

      if (decision.roleParecer) {
        patch.item_type_id = lotePaymentTypeId;
        patch.item_type_source = "report_cross";
        patch.reclassified_from_parecer = false;
        if (decision.evidence === "confirmed") parecerConfirmed++;
        else parecerUnverified++;
      } else if (decision.roleVisita) {
        patch.item_type_id = visitaPaymentTypeId;
        patch.item_type_source = "report_cross";
        patch.reclassified_from_parecer = true;
        visitas++;
      }
      enqueue(it.id, patch);
    }

    const APPLY_CHUNK = 200;
    for (const g of groups.values()) {
      for (let i = 0; i < g.ids.length; i += APPLY_CHUNK) {
        const slice = g.ids.slice(i, i + APPLY_CHUNK);
        const { error } = await supabase
          .from("payment_items")
          .update(g.patch as any)
          .in("id", slice);
        if (error) {
          console.error(
            `[cross-reference-parecer] batch update fail (${slice.length} ids)`,
            error.message,
          );
        }
      }
    }

    // ==== Persiste cross_summary em cada relatório do lote ====
    const summary = {
      finished_at: now,
      items_total: items.length,
      candidates_considered: candidates.length,
      parecer_confirmed: parecerConfirmed,
      parecer_unverified: parecerUnverified,
      visitas,
      skipped_no_key: skippedNoKey.length,
      skipped_no_key_sample_ids: skippedNoKey.slice(0, 20),
      protected_kept: protectedKept,
    };
    try {
      const { error: sumErr } = await supabase
        .from("payment_parecer_reports")
        .update({ cross_summary: summary })
        .eq("payment_id", payment_id);
      if (sumErr) console.warn("[cross-reference-parecer] cross_summary persist fail", sumErr.message);
    } catch (e) {
      console.warn("[cross-reference-parecer] cross_summary persist exception", e);
    }

    console.log(
      `[cross-reference-parecer] done payment_id=${payment_id} ${JSON.stringify(summary)}`,
    );

    // Dispara reanálise (mesma UX do fluxo anterior).
    if (trigger_reanalysis) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-payment-analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            payment_id,
            force_fresh_rules: true,
            skip_parecer_cross_ref: true,
          }),
        });
        const txt = await resp.text();
        if (!resp.ok) {
          console.warn("[cross-reference-parecer] dispatch retornou erro", resp.status, txt.slice(0, 500));
        }
      } catch (e) {
        console.warn("[cross-reference-parecer] dispatch falhou", e);
      }
    }

    // Compat: mantém chaves antigas (confirmed, not_found, reclassified) e
    // adiciona as novas (parecer_confirmed, parecer_unverified, visitas...).
    return new Response(
      JSON.stringify({
        ok: true,
        items_total: items.length,
        report_rows: allRows.length,
        has_report: true,
        // legado
        confirmed: parecerConfirmed,
        not_found: notFoundLegacy,
        reclassified: 0,
        auto_applied: parecerConfirmed + parecerUnverified + visitas,
        subtype_parecer: parecerConfirmed + parecerUnverified,
        subtype_visita: visitas,
        // novo
        cross_summary: summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[cross-reference-parecer]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
