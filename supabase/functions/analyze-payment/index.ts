// analyze-payment — Fase 3
// Motor determinístico (TS puro) decide regra vencedora e calcula expected.
// IA roda apenas em itens marcados como `needs_ai_review` (alerta/reprovado)
// e SÓ produz justificativa textual — não muda status, regra ou valor.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

import {
  analyzePaymentItems,
  extendSectorMap,
  extendConvenioMap,
  inferItemSector,
  normName,
  drainLearnedAliases,
  selectWinningRule,
  calcItemMatches,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
  type AnalysisResult,
} from "../_shared/rulesEngine.ts";
import {
  mapCalculationTypeToMethod,
  type AppliedCalcMethod,
} from "../_shared/calcMethodMapping.ts";
import { buildScopedRulesOr } from "../_shared/scopedRulesFilter.ts";
import { anthropicFetch } from "../_shared/anthropicWithFallback.ts";
import { classifyDuplicateMatch, evaluateDuplicate, type DuplicateOverridePayload } from "../_shared/itemHash.ts";
import {
  buildAiInputHash,
  buildSiblingsDigest,
  type EngineSnapshot,
  type SiblingItem,
} from "../_shared/aiInputHash.ts";
import { maskPatients, unmaskText, type ReverseMap } from "../_shared/aiPrivacy.ts";
import { buildPrimaryItemByRole, isPrimaryAnchor, normRole } from "../_shared/packagePrimary.ts";
import {
  rankAnchorsByAccessRoute,
  findPackagesWithoutAnchor,
  type AnchorCandidate,
} from "../_shared/packagePicker.ts";
import { normAccessRoute } from "../_shared/rulesEngine.ts";
import {
  normDocKey,
  sheetSpecialtyFromRaw,
  makeResolveMedicalSpecialty,
} from "../_shared/specialtyResolver.ts";
// rebuild: allowlist estrita para group_company_links com doctors preenchido (2026-06-04)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentRow {
  sectors: string[] | null;
  specialties: string[] | null;
  payment_type: string | null;
  payment_due_date: string | null;
  competence_month: string | null;
  analysis_mode: "padrao" | "empresa_prioritaria" | "isolado" | "confeccao" | null;
}

const RAW_SECTOR_KEYS = new Set([
  "setor",
  "setor atendimento",
  "setor do atendimento",
  "setor executante",
  "centro de custo",
  "centro custo",
  "ds setor atendimento",
  "nome setor",
]);

function rawSectorFromRawData(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!RAW_SECTOR_KEYS.has(normName(key))) continue;
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return null;
}

// Entry point: detecta `_async:true` no body e roda o processamento via
// `EdgeRuntime.waitUntil`, respondendo 202 imediatamente. Isso evita o
// IDLE_TIMEOUT (150s) da Edge Runtime — o trabalho continua em background e
// reporta progresso via `increment_processing_progress` / safety-net finally.
// Quando chamado sem `_async` (testes, dry-run, simulação), mantém o
// comportamento síncrono original.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);
  const bodyText = await req.text();

  let asyncFlag = false;
  try { asyncFlag = JSON.parse(bodyText)?._async === true; } catch { /* body inválido — segue síncrono e deixa o handler tratar */ }
  const buildReq = () => new Request(req.url, { method: req.method, headers: req.headers, body: bodyText });
  if (asyncFlag) {
    // @ts-ignore EdgeRuntime existe no runtime Supabase Edge Functions
    EdgeRuntime.waitUntil(
      handleAnalyzePayment(buildReq(), auth).catch((e) => console.error("[analyze-payment][bg] erro não-capturado:", e)),
    );
    return new Response(JSON.stringify({ status: "accepted", mode: "async" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return await handleAnalyzePayment(buildReq(), auth);
});

async function handleAnalyzePayment(req: Request, auth: Awaited<ReturnType<typeof requireInternalOrRole>>): Promise<Response> {

  const startTime = Date.now();
  let diagnostics = {
    total_items: 0,
    ai_processed_items: 0,
    chunk_size: 100, // Limite configurado
    execution_time_ms: 0,
    status: "processing"
  };

  // Hoisted p/ ficar acessível ao catch (req.json() consome o body, então
  // tentar req.clone().json() depois falha silenciosamente e o job trava).
  let __payment_id: string | undefined;
  let __job_id: string | undefined;
  let __company_label: string | undefined;
  let __company_name: string | undefined;
  let __paymentHospitalIdHoisted: string | null = null;
  // [Sprint 1 - Tier 3.H] Sentinela: garante que increment_processing_progress
  // seja chamado EXATAMENTE uma vez (sucesso OU falha OU exceção exótica).
  // Sem isso, exceções fora do try/catch principal travam o job em "99%".
  let __progress_reported = false;

  // [Sprint 4 - Observabilidade] Métricas por empresa para `analysis_telemetry`.
  const __telemetry = {
    rules_ms: 0,
    ai_ms: 0,
    writes_ms: 0,
    items_count: 0,
    ai_items_count: 0,
    cache_hit: false,
    // Sub-métricas da IA: quantos chunks rodaram, quantos falharam (após retries)
    // e quantas vezes foi necessário tentar de novo. Servem para correlacionar
    // "empresa X sumiu da IA" com timeouts reais em vez de bug de pipeline.
    ai_chunks_total: 0,
    ai_chunks_failed: 0,
    ai_chunks_retried: 0,
    // Cache determinístico da IA (short-circuit por hash de entrada).
    // Ver supabase/functions/_shared/aiInputHash.ts.
    ai_items_skipped_cache: 0,
  };


  try {
    const parsedBody = await req.json();
    const { payment_id, company_name, ai_statuses, tolerance_pct, is_dry_run, _job_id, _company_label, _force_fresh, skip_ai, _skip_ai } = parsedBody;
    __payment_id = payment_id;
    __job_id = _job_id;
    __company_label = _company_label;
    const __force_fresh = _force_fresh === true;
    // [2026-07-14] IA opt-in: se nenhum dos flags vier no body, motor puro (skip_ai=true).
    // IA só roda quando o chamador explicitamente passar skip_ai=false ou _skip_ai=false.
    const __skip_ai = (skip_ai === false || _skip_ai === false) ? false : true;
    __company_name = company_name;
    // [TIMING] prefixo curto p/ diferenciar workers concorrentes nos logs
    const __t = `[T:${(_company_label ?? company_name ?? "all").toString().slice(0, 24)}]`;

    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    // Hidrata aliases de setor/convênio a partir do cadastro, filtrando por
    // escopo do hospital do pagamento (globais + hospital-specific). Feito após
    // carregar `payment` mais abaixo. Aqui só declaramos.
    // (blocos movidos para após o fetch de `payment`)

    // Reanálise NÃO pode ser pulada por `payment_company_groups.updated_at`.
    // Esse timestamp também muda por rotinas paralelas (snapshots, financeiros,
    // deduções etc.) e já causou falso "concluído" sem recalcular a empresa.
    // A idempotência fica no orquestrador (claim de página + job único ativo).


    // ---------- 1. carrega payment ----------
    const { data: payment } = await supabase
      .from("payments")
      .select("sectors,specialties,payment_type,payment_model_id,payment_due_date,competence_month,analysis_mode,hospital_id,import_mode,pool_id")
      .eq("id", payment_id)
      .maybeSingle<PaymentRow & { import_mode?: string | null; payment_model_id?: string | null }>();

    const ctx: PaymentContext = {
      sectors: payment?.sectors ?? [],
      specialties: payment?.specialties ?? [],
      payment_type: payment?.payment_type ?? null,
      payment_model: (payment as any)?.payment_model_id ?? null,
      // Onda 1 — Regra de competência: a vigência é determinada pela
      // `procedure_date` de CADA item dentro do motor (analyzeItem).
      // `reference_date` aqui é apenas informativo e NÃO é usado para
      // selecionar regra. Mantido por compat com o tipo PaymentContext.
      reference_date: payment?.payment_due_date
        ?? payment?.competence_month
        ?? new Date().toISOString().slice(0, 10),
      tolerance_pct: typeof tolerance_pct === "number" ? tolerance_pct : undefined,
    };
    const isEmpresaPrioritaria = payment?.analysis_mode === "empresa_prioritaria";
    const isConfeccao = payment?.analysis_mode === "confeccao";
    // Importação histórica: motor roda normalmente (calcula diferenca_regra,
    // alimenta DRE) e os grupos caem em `revisao_analista` como num lote
    // comum, para que o analista possa revisar/ajustar antes de concluir.
    // A marcação final como `pago` é feita por ação explícita do analista
    // via RPC `conclude_historico_payment` (não auto-promove).
    // ⚠️ Auto-aprendizado de aliases continua suprimido para historico
    //    (ver bloco mais abaixo) — bases antigas não devem contaminar cadastros.
    const isHistorico = (payment as any)?.import_mode === "historico";

    // ---------- 1b. Hidrata setores/convênios ESCOPADOS ao hospital ----------
    // Globais (hospital_id IS NULL) + do hospital do pagamento. Convênios ou
    // setores exclusivos de outros hospitais NUNCA entram no motor deste lote.
    const __paymentHospitalId = ((payment as any)?.hospital_id as string | null) ?? null;
    __paymentHospitalIdHoisted = __paymentHospitalId;
    if (!auth.is_internal && !assertCallerHospital(auth, __paymentHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    try {
      let secQ = supabase.from("sectors").select("slug,name,aliases,hospital_id").eq("active", true);
      if (__paymentHospitalId) secQ = secQ.or(`hospital_id.is.null,hospital_id.eq.${__paymentHospitalId}`);
      else secQ = secQ.is("hospital_id", null);
      const { data: secs } = await secQ;
      if (secs?.length) extendSectorMap(secs as Array<{ slug: string; name: string; aliases: string[] }>);
    } catch (_e) { /* fallback ao SECTOR_MAP estático */ }
    try {
      let convQ = supabase.from("convenios").select("slug,name,aliases,hospital_id").eq("active", true);
      if (__paymentHospitalId) convQ = convQ.or(`hospital_id.is.null,hospital_id.eq.${__paymentHospitalId}`);
      else convQ = convQ.is("hospital_id", null);
      const { data: convs } = await convQ;
      if (convs?.length) extendConvenioMap(convs as Array<{ slug: string; name: string; aliases: string[] }>);
    } catch (_e) { /* fallback à normalização pura */ }
    try {
      // Aliases aprendidos/cadastrados vivem em `convenio_aliases` (tabela dedicada)
      // e NÃO na coluna array `convenios.aliases`. Sem esta carga, o motor cai nos
      // stems hardcoded e resolve para o slug genérico (ex.: `sul_america`) em vez
      // da variante por hospital (`sul_america_hsh`), quebrando whitelist/blacklist.
      let aliasQ = supabase.from("convenio_aliases").select("convenio_slug,alias_text,hospital_id");
      if (__paymentHospitalId) aliasQ = aliasQ.or(`hospital_id.is.null,hospital_id.eq.${__paymentHospitalId}`);
      else aliasQ = aliasQ.is("hospital_id", null);
      const { data: aliasRows, error: aliasErr } = await aliasQ;
      if (aliasErr) console.warn(`${__t} convenio_aliases load falhou: ${aliasErr.message}`);
      if (aliasRows?.length) {
        // Globais primeiro, hospital-específicos depois: o específico sobrescreve.
        const sorted = [...(aliasRows as any[])].sort(
          (a, b) => (a.hospital_id ? 1 : 0) - (b.hospital_id ? 1 : 0),
        );
        extendConvenioMap(
          sorted.map((r) => ({ slug: String(r.convenio_slug), aliases: [String(r.alias_text)] })),
        );
      }
    } catch (_e) { /* fallback: convenios.aliases + stems */ }




    // ---------- 2. carrega configurações globais e regras ----------
    const __rulesStart = Date.now();
    console.time(`${__t} carregar_regras`);

    // [Sprint 1 - Tier 1.A] Resolve company_id para filtrar regras por escopo.
    // Sem isso, carregamos TODAS as regras ativas em cada worker (× N empresas),
    // saturando o pool Postgres em lotes grandes. Com filtro por escopo, cada
    // worker carrega só regras aplicáveis (master + específica daquela empresa
    // + grupos que contêm aquela empresa).
    let scopedCompanyId: string | null = null;
    // 1) Preferencial: company_id explícito no payload (dispatcher pode passar)
    const payloadCompanyId = (parsedBody as any)?.company_id;
    if (payloadCompanyId && typeof payloadCompanyId === "string") {
      scopedCompanyId = payloadCompanyId;
    } else if (company_name && typeof company_name === "string") {
      // 2) Cruzamento por nome exato no cadastro
      const { data: companyRow } = await supabase
        .from("companies")
        .select("id")
        .eq("name", company_name)
        .limit(1)
        .maybeSingle();
      scopedCompanyId = (companyRow?.id as string | null) ?? null;
      // 3) Cruzamento por alias do cadastro (companies.aliases)
      if (!scopedCompanyId) {
        const { data: aliasRow } = await supabase
          .from("companies")
          .select("id")
          .contains("aliases", [company_name])
          .limit(1)
          .maybeSingle();
        scopedCompanyId = (aliasRow?.id as string | null) ?? null;
      }
      // 4) Fallback via payment_items (último recurso)
      if (!scopedCompanyId) {
        const { data: itemRow } = await supabase
          .from("payment_items")
          .select("company_id")
          .eq("payment_id", payment_id)
          .eq("company_name", company_name)
          .not("company_id", "is", null)
          .limit(1)
          .maybeSingle();
        scopedCompanyId = (itemRow?.company_id as string | null) ?? null;
      }
      if (!scopedCompanyId) {
        console.warn(`${__t} company_id não resolvido para "${company_name}" — carregando regras sem filtro de escopo (degrada performance). Verifique cadastro/aliases em \`companies\`.`);
      }
    }

    const RULES_SELECT = `
        id,name,rule_text,description,active,severity,scope,
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
        limiar_alerta_tipo, limiar_alerta_valor, limiar_bloqueio_tipo, limiar_bloqueio_valor,
        force_totalized,
        prevent_external_fallback,
        special_case_filter,
        item_type_id
    `;

    const RULE_CALCS_SELECT = `
      id,rule_id,label,sort_order,calculation_type,
      time_mode,time_start,time_end,weekdays,includes_holidays,elective_mode,
      convenio_percentage,fixed_amount,fixed_amount_by_role,
      package_amount,package_main_code,package_included_codes,package_visits_count,
      package_opinions_count,package_auxiliaries_included,package_subtype,extras_codes,
      reference_table_id,multiplier,deflator_pct,repasse_pct,acrescimo_pct,
      apply_access_route,include_auxiliaries,
      auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
      bonus_amount,bonus_pct,target_amount,allowed_access_routes,
      force_totalized,application_unit,sectors,specialties,match_by_specialty,
      special_case_filter,
      item_type_id,
      procedure_codes,code_match_mode,doctor_roles,
      agreement_match_mode,agreement_aliases,procedure_keywords,context_conditions,
      package_roles_distribution,
      adicional_fds_pct,adicional_feriado_pct,adicional_noturno_pct,adicional_urgencia_pct,noturno_inicio,noturno_fim,
      is_catch_all,
      contagia_atendimento
    `;


    // [Sprint 3 - Tier 1.B] Cache de contexto compartilhado por job:
    // rules + rule_calculations + system_configurations são IGUAIS para todas as
    // empresas do mesmo job. Em lotes com 100+ empresas, carregar tudo do banco
    // por worker dominava o tempo (~60% do total). Persistimos um snapshot em
    // payment_job_context na primeira execução e reusamos nas demais.
    const CONTEXT_TTL_MS = 60 * 60 * 1000; // 1h
    let cachedRulesAll: any[] | null = null;
    let cachedCalcsByRule: Record<string, any[]> | null = null;
    let cachedConfigs: any[] | null = null;

    // Correção A (2026-07-19): antes de aceitar o snapshot, comparamos com a
    // assinatura atual de regras+cálculos do hospital. Qualquer edição bumpa
    // `updated_at`, o md5 muda, e o snapshot é rejeitado — invalidação
    // automática por conteúdo. Substitui os guards por campo (item_type_id,
    // special_case_filter, etc.), que só cobriam mudança de schema.
    const _paymentHospitalIdForSig: string | null = (payment as any)?.hospital_id ?? null;
    let currentRulesSignature: string | null = null;
    if (__job_id && !__force_fresh && _paymentHospitalIdForSig) {
      try {
        const { data: sig } = await supabase.rpc("get_rules_signature", {
          _hospital_id: _paymentHospitalIdForSig,
        });
        if (typeof sig === "string") currentRulesSignature = sig;
      } catch (e) {
        console.warn(`${__t} get_rules_signature falhou`, (e as any)?.message ?? e);
      }
    }

    if (__job_id && !__force_fresh) {
      try {
        const { data: cacheRow } = await supabase
          .from("payment_job_context")
          .select("context, built_at")
          .eq("job_id", __job_id)
          .maybeSingle();
        if (cacheRow?.context) {
          const ageMs = Date.now() - new Date(cacheRow.built_at as string).getTime();
          if (ageMs < CONTEXT_TTL_MS) {
            const ctxJ = cacheRow.context as any;
            const snapshotSig = typeof ctxJ.rules_signature === "string" ? ctxJ.rules_signature : null;
            const signatureMatches =
              currentRulesSignature != null &&
              snapshotSig != null &&
              snapshotSig === currentRulesSignature;
            if (Array.isArray(ctxJ.rules) && ctxJ.calcs_by_rule && Array.isArray(ctxJ.configs) && signatureMatches) {
              cachedRulesAll = ctxJ.rules;
              cachedCalcsByRule = ctxJ.calcs_by_rule;
              cachedConfigs = ctxJ.configs;
              __telemetry.cache_hit = true;
              console.log(`${__t} ctx_cache HIT (age=${Math.round(ageMs / 1000)}s, rules=${cachedRulesAll.length}, sig=match)`);
            } else if (!signatureMatches) {
              console.log(`${__t} ctx_cache BUST (sig mismatch — regras/cálculos foram alterados desde o snapshot)`);
            }
          }
        }
      } catch (e) {
        console.warn(`${__t} ctx_cache lookup falhou`, (e as any)?.message ?? e);
      }
    } else if (__force_fresh) {
      console.log(`${__t} ctx_cache BYPASS (_force_fresh=true) — recarregando regras direto do banco`);
    }

    let rules: RuleInput[] = [];
    let configs: any[] = [];

    if (cachedRulesAll && cachedConfigs && cachedCalcsByRule) {
      // Filtra regras por escopo em memória.
      configs = cachedConfigs;
      const filtered = scopedCompanyId
        ? cachedRulesAll.filter((r: any) => {
            if (r.scope === "master") return true;
            if (r.scope === "especifica") {
              if (r.target_type === "medico") return true;
              return r.target_company_id === scopedCompanyId;
            }
            if (r.scope === "grupo") {
              // group_doctors seguem o médico em qualquer PJ — não dá pra filtrar por empresa aqui.
              // O motor (targetsGroup) faz o match final por médico/PJ.
              const looseDoctors = Array.isArray(r.group_doctors) ? r.group_doctors : [];
              if (looseDoctors.length > 0) return true;
              const links = Array.isArray(r.group_company_links) ? r.group_company_links : [];
              return links.some((l: any) => l?.company_id === scopedCompanyId);
            }
            return false;
          })
        : cachedRulesAll;
      rules = filtered as unknown as RuleInput[];
      for (const r of rules) {
        const list = cachedCalcsByRule[(r as any).id] ?? [];
        if (list.length > 0) (r as any).calculations = list;
      }
    } else {
      // Cache miss → caminho original + grava snapshot ao final.
      let rulesQuery = supabase.from("rules").select(RULES_SELECT).eq("active", true);
      // Isolamento multi-tenant: regras são por hospital.
      const paymentHospitalId = (payment as any)?.hospital_id ?? null;
      if (paymentHospitalId) {
        rulesQuery = rulesQuery.eq("hospital_id", paymentHospitalId);
      }
      if (scopedCompanyId) {
        // Filtro canônico — ver `_shared/scopedRulesFilter.ts` + teste de
        // contrato `scopedRulesFilter_test.ts`. NÃO duplicar o OR à mão.
        rulesQuery = rulesQuery.or(buildScopedRulesOr(scopedCompanyId));
      }

      const [configRes, rulesRes] = await Promise.all([
        supabase.from("system_configurations").select("key,value").in("key", ["divergence_thresholds", "medical_role_aliases"]),
        rulesQuery,
      ]);

      configs = (configRes.data ?? []) as any[];
      if (rulesRes.error) {
        console.error("[analyze-payment] rules query error:", rulesRes.error);
        throw new Error(`Falha ao carregar regras ativas: ${rulesRes.error.message}`);
      }
      if (configRes.error) {
        console.warn("[analyze-payment] system_configurations query warning:", configRes.error);
      }
      rules = (rulesRes.data ?? []) as unknown as RuleInput[];

      // 2.1 Carrega cálculos (1:N) e anexa
      if (rules.length > 0) {
        const ruleIds = rules.map((r) => r.id);
        const { data: calcRows, error: calcRowsErr } = await supabase
          .from("rule_calculations")
          .select(RULE_CALCS_SELECT)
          .in("rule_id", ruleIds)
          .order("sort_order", { ascending: true });
        if (calcRowsErr) {
          console.error("[analyze-payment] rule_calculations query error:", calcRowsErr);
          throw new Error(`Falha ao carregar cálculos das regras: ${calcRowsErr.message}`);
        }
        const byRule: Record<string, any[]> = {};
        for (const c of (calcRows ?? []) as any[]) {
          (byRule[c.rule_id as string] ||= []).push(c);
        }
        for (const r of rules) {
          const list = byRule[r.id] ?? [];
          if (list.length > 0) (r as any).calculations = list;
        }
      }

      // Grava snapshot do contexto (best-effort, fire-and-forget seguro).
      // Para popular o cache, recarrega regras SEM filtro de escopo — assim
      // próximas empresas do mesmo job aproveitam mesmo com escopo diferente.
      if (__job_id) {
        (async () => {
          try {
            let allRulesQ = supabase.from("rules").select(RULES_SELECT).eq("active", true);
            if (paymentHospitalId) allRulesQ = allRulesQ.eq("hospital_id", paymentHospitalId);
            const { data: allRules } = await allRulesQ;
            const allRuleIds = (allRules ?? []).map((r: any) => r.id);
            let allCalcs: any[] = [];
            if (allRuleIds.length > 0) {
              const { data } = await supabase
                .from("rule_calculations")
                .select(RULE_CALCS_SELECT)
                .in("rule_id", allRuleIds)
                .order("sort_order", { ascending: true });
              allCalcs = data ?? [];
            }
            const calcsByRule: Record<string, any[]> = {};
            for (const c of allCalcs) (calcsByRule[c.rule_id as string] ||= []).push(c);
            // Assinatura preferencialmente já obtida no início; se veio null
            // (força-fresh, hospital nulo, RPC falhou), computa aqui — sem
            // deixar snapshot sem assinatura, senão o próximo HIT quebra.
            let sigForWrite = currentRulesSignature;
            if (!sigForWrite && paymentHospitalId) {
              const { data: sig } = await supabase.rpc("get_rules_signature", {
                _hospital_id: paymentHospitalId,
              });
              if (typeof sig === "string") sigForWrite = sig;
            }
            const snapshot = {
              rules: allRules ?? [],
              calcs_by_rule: calcsByRule,
              configs,
              rules_signature: sigForWrite ?? null,
            };
            const sizeBytes = JSON.stringify(snapshot).length;
            await supabase.from("payment_job_context").upsert({
              job_id: __job_id,
              payment_id,
              context: snapshot,
              built_at: new Date().toISOString(),
              size_bytes: sizeBytes,
              meta: { rules_count: (allRules ?? []).length, calcs_count: allCalcs.length, rules_signature: sigForWrite ?? null },
            }, { onConflict: "job_id" });
            console.log(`${__t} ctx_cache WRITE (rules=${(allRules ?? []).length}, ${Math.round(sizeBytes / 1024)}KB, sig=${sigForWrite ? "ok" : "null"})`);
          } catch (e) {
            console.warn(`${__t} ctx_cache write falhou`, (e as any)?.message ?? e);
          }
        })();
      }
    }

    console.log(`${__t} regras carregadas: ${rules.length} (scoped=${scopedCompanyId ? "sim" : "não"}, cache=${cachedRulesAll ? "hit" : "miss"})`);

    const divergenceConfig = configs.find(c => c.key === "divergence_thresholds");
    const roleAliasesConfig = configs.find(c => c.key === "medical_role_aliases");

    const globalThresholds = divergenceConfig?.value as any || {
      limiar_alerta_tipo: "percentual",
      limiar_alerta_valor: 1.0,
      limiar_bloqueio_tipo: "percentual",
      limiar_bloqueio_valor: 5.0
    };

    const roleAliases = (roleAliasesConfig?.value as Record<string, string[]>) || {};

    (ctx as any).globalThresholds = globalThresholds;

    console.timeEnd(`${__t} carregar_regras`);
    __telemetry.rules_ms = Date.now() - __rulesStart;



    // ---------- 3. carrega itens (filtra por empresa se aplicável) ----------
    console.time(`${__t} carregar_itens`);
    // IMPORTANTE: Se estamos analisando uma empresa específica, processamos TODOS os itens dela
    // para garantir que a visão do usuário reflita a planilha original.
    // O filtro ai_statuses só deve ser aplicado na reanálise global filtrada.
    const filterApplied = !company_name && Array.isArray(ai_statuses) && ai_statuses.length > 0;

    const buildItemsQuery = () => {
      let q = supabase
        .from("payment_items")
        .select(`
          id,doctor_name,doctor_document,doctor_id,company_name,company_id,
          procedure_code,procedure_name,description,access_route,doctor_role,
          procedure_amount,gross_amount,attendance_number,patient_name,procedure_date,procedure_date_has_time,quantity,
          authorized_exception,exception_reason,exception_authorizer,exception_note,
          tipo_linha,complement_reason,
          agreement_text,specialty,tipo_item,sector,attendance_character,
          convenio_value_totalized,
          package_absorbed,
          package_absorbed_calc_id,
          package_absorbed_by,
          package_ambiguity,
          ai_status,
          gross_override_at,
          item_hash,
          ai_findings,
          special_case_code,
          special_case_status,
          calc_exception_skip,
          calc_exception_skipped_calc_id,
          manual_intervention_reason_id,
          manual_intervention_source,
          manual_intervention_reason:manual_intervention_reasons!manual_intervention_reason_id(code,category),
          item_type_id,
          item_type_source,
          is_pool_item,
          raw_data
        `)
        .eq("payment_id", payment_id);
      if (company_name && typeof company_name === "string") q = q.eq("company_name", company_name);
      if (filterApplied) q = q.in("ai_status", ai_statuses as string[]);
      return q;
    };

    // Idempotência do split de bônus: linhas sintéticas de execuções anteriores
    // não podem entrar no motor nem no cálculo de grupos da reanálise atual.
    // Por isso limpamos o escopo antes de carregar os itens-base.
    if (!is_dry_run && (company_name || !filterApplied)) {
      let oldBonusDelete = supabase
        .from("payment_items")
        .delete()
        .eq("payment_id", payment_id)
        .eq("tipo_linha", "complemento_bonus")
        .eq("tipo_item", "bonus");
      if (company_name && typeof company_name === "string") {
        oldBonusDelete = oldBonusDelete.eq("company_name", company_name);
      }
      const { error: oldBonusErr } = await oldBonusDelete;
      if (oldBonusErr) console.error(`${__t} bonus_preclean_error`, oldBonusErr);
    }

    // PostgREST cap `db-max-rows` (1000) truncava lotes grandes silenciosamente.
    // Paginamos explicitamente até esgotar (query reconstruída a cada página).
    const PAGE_ITEMS = 1000;
    const itemsAcc: any[] = [];
    for (let offset = 0; ; offset += PAGE_ITEMS) {
      const { data: page, error: pageErr } = await buildItemsQuery().range(offset, offset + PAGE_ITEMS - 1);
      if (pageErr) { console.error(`${__t} items_page_error`, pageErr); break; }
      const rows = (page ?? []) as any[];
      itemsAcc.push(...rows);
      if (rows.length < PAGE_ITEMS) break;
      if (offset + PAGE_ITEMS >= 100000) break;
    }
    const itemsRaw = itemsAcc;

    // Quando há filtro por ai_statuses, o subset acima não inclui todos os itens
    // do atendimento. Carregamos uma visão slim de TODOS os itens do payment
    // exclusivamente para construir o índice de siblings (condições de contexto).
    let siblingsRaw: Array<{ id: string; attendance_number: string | null; procedure_code: string | null }> | null = null;
    if (filterApplied) {
      const sibAcc: Array<{ id: string; attendance_number: string | null; procedure_code: string | null }> = [];
      for (let offset = 0; ; offset += PAGE_ITEMS) {
        const { data: sibPage } = await supabase
          .from("payment_items")
          .select("id, attendance_number, procedure_code")
          .eq("payment_id", payment_id)
          .range(offset, offset + PAGE_ITEMS - 1);
        const rows = (sibPage ?? []) as any[];
        sibAcc.push(...rows);
        if (rows.length < PAGE_ITEMS) break;
        if (offset + PAGE_ITEMS >= 200000) break;
      }
      siblingsRaw = sibAcc;
    }


    console.timeEnd(`${__t} carregar_itens`);

    // ---------- 3.1 Classificação determinística por código TUSS ----------
    // Roda ANTES da seleção de regras de pagamento.
    const codes = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => (it.procedure_code ?? "").toString().trim()).filter(Boolean),
    ));
    const classificationByCode: Record<string, { sector: string; source: string; confidence: string }> = {};
    if (codes.length > 0) {
      const { data: classRows } = await supabase
        .from("procedure_classifications")
        .select("code_tuss,sector_classified,confidence,active")
        .in("code_tuss", codes)
        .eq("active", true);
      for (const c of (classRows ?? []) as any[]) {
        // primeira classificação ativa por código vence (índice único garante 1 por setor)
        if (!classificationByCode[c.code_tuss]) {
          classificationByCode[c.code_tuss] = {
            sector: c.sector_classified,
            source: c.sector_classified === "hemodinamica"
              ? "tabela_procedimentos_hemodinamica"
              : `tabela_procedimentos_${c.sector_classified}`,
            confidence: c.confidence ?? "alta",
          };
        }
      }
    }

    // Carrega CNPJ das empresas referenciadas (para casamento de regras por empresa)
    const companyIds = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => it.company_id).filter(Boolean),
    )) as string[];
    let companyDocs: Record<string, string | null> = {};
    if (companyIds.length > 0) {
      const { data: cs } = await supabase
        .from("companies")
        .select("id,document")
        .in("id", companyIds);
      for (const c of cs ?? []) companyDocs[c.id as string] = (c.document as string | null) ?? null;
    }
    // Pool soberano: itens coletivos têm company_id=null. Carregamos as PJs
    // participantes do pool deste pagamento para que regras de grupo/empresa
    // possam casar via pool_company_ids (ver ItemInput.pool_company_ids).
    let poolCompanyIds: string[] = [];
    const hasPoolItems = (itemsRaw ?? []).some((it: any) => it.is_pool_item === true);
    if (hasPoolItems) {
      const pmtPoolId = (payment as any)?.pool_id ?? null;
      if (pmtPoolId) {
        const { data: parts } = await supabase
          .from("pool_participants")
          .select("company_id")
          .eq("pool_id", pmtPoolId);
        poolCompanyIds = (parts ?? [])
          .map((p: any) => p?.company_id as string | null)
          .filter((x: string | null): x is string => !!x);
      }
    }

    // ---------- 3.15 Resolução de ESPECIALIDADE MÉDICA ----------
    // O campo `specialty` em payment_items representa especialidade médica
    // (Urologia, Ortopedia, ...). O `tipo_item` representa o ato (Cirurgia,
    // Anestesia, ...) e NÃO é usado como especialidade.
    // Resolvemos a especialidade médica de cada item em runtime via:
    //   1) raw_data da planilha (ex.: "Especialidade Médico") — fonte canônica;
    //   2) payment_items.specialty, para bases legadas sem raw_data completo;
    //   3) doctors.specialties[0] quando o médico tem só uma especialidade;
    //   4) null → cálculos com match_by_specialty=true são pulados e auditados.
    const specMap: Record<string, string> = {};
    if (codes.length > 0) {
      const { data: smRows } = await supabase
        .from("procedure_specialty_map")
        .select("procedure_code,medical_specialty,status")
        .eq("status", "aprovado")
        .in("procedure_code", codes);
      for (const r of (smRows ?? []) as any[]) {
        specMap[String(r.procedure_code)] = String(r.medical_specialty);
      }
    }

    // Cache de especialidades por médico — chave NORMALIZADA (trim+lowercase)
    // para tolerar diferença de caixa entre planilha ("Karimi Da Silva…") e
    // cadastro ("Karimi da Silva…"). Sem isso, a busca .in() falha em silêncio
    // e `resolveMedicalSpecialty` devolve null mesmo quando o médico tem
    // especialidade única cadastrada — fazendo cálculos com match_by_specialty
    // serem rejeitados por "especialidade_nao_informada".
    // normDocKey importado de _shared/specialtyResolver.ts
    const doctorNamesNorm = Array.from(new Set(
      (itemsRaw ?? [])
        .map((it: any) => String(it.doctor_name ?? "").trim())
        .filter(Boolean),
    ));
    const doctorSpecsByName: Record<string, string[]> = {};
    if (doctorNamesNorm.length > 0) {
      // Busca todos os médicos ativos e indexa em memória pelo nome normalizado.
      // Volume típico (< 5k médicos por hospital) cabe sem paginação extra.
      const { data: docs } = await supabase
        .from("doctors")
        .select("full_name,specialties,active")
        .eq("active", true);
      const wanted = new Set(doctorNamesNorm.map(normDocKey));
      for (const d of (docs ?? []) as any[]) {
        const key = normDocKey(String(d.full_name ?? ""));
        if (!wanted.has(key)) continue;
        doctorSpecsByName[key] = Array.isArray(d.specialties) ? d.specialties : [];
      }
    }

    const normSpec = (s: string) => s.trim().toLowerCase();

    const normRawHeader = (s: string) => String(s ?? "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
    // sheetSpecialtyFromRaw / makeResolveMedicalSpecialty importados de
    // _shared/specialtyResolver.ts — ver testes de regressão em
    // _shared/specialty_regression_test.ts.

    // ---------- 3.16 Especialidade DOMINANTE do lote/empresa ----------
    // Conta a especialidade resolvida (via procedure_specialty_map) de cada
    // item. Se uma concentra > 51% dos itens com especialidade conhecida,
    // ela é a "especialidade do lote" — usada como fallback para itens cujo
    // código não está mapeado, e persistida em payments.specialties para
    // rastreabilidade e indicador.
    const specCounts: Record<string, { label: string; count: number }> = {};
    let withSpec = 0;
    for (const it of (itemsRaw ?? []) as any[]) {
      const code = (it.procedure_code ?? "").toString().trim();
      const sp = code ? specMap[code] : null;
      if (!sp) continue;
      const k = normSpec(sp);
      (specCounts[k] ||= { label: sp, count: 0 }).count++;
      withSpec++;
    }
    let dominantSpecialty: string | null = null;
    if (withSpec > 0) {
      const sorted = Object.values(specCounts).sort((a, b) => b.count - a.count);
      const top = sorted[0];
      if (top && top.count / withSpec > 0.51) dominantSpecialty = top.label;
    }

    const resolveMedicalSpecialty = makeResolveMedicalSpecialty(doctorSpecsByName);



    const items: ItemInput[] = (itemsRaw ?? []).map((it: any) => {
      const code = (it.procedure_code ?? "").toString().trim();
      const cls = code ? classificationByCode[code] : undefined;
      const resolved = resolveMedicalSpecialty(it);
      // Anota fonte para persistir em ai_findings depois
      (it as any).__resolved_specialty = resolved;
      const persistedSector = it.sector ?? null;
      const rawSector = rawSectorFromRawData(it.raw_data);
      // HIERARQUIA: planilha (rawSector) SEMPRE prevalece. O persistido só
      // vale quando a planilha não trouxe setor. Isso evita que o setor do
      // LOTE gravado em payment_items.sector sobrescreva o setor real da
      // linha em lotes mistos (ex.: "Centro Cirúrgico e Hemodinâmica").
      const recoveredSector = rawSector && String(rawSector).trim() !== ""
        ? rawSector
        : (persistedSector && !["outro", "outros"].includes(normName(persistedSector))
            ? persistedSector
            : null);

      return ({
      id: it.id,
      doctor_name: it.doctor_name,
      doctor_document: it.doctor_document,
      doctor_id: it.doctor_id ?? null,
      company_name: it.company_name,
      company_id: it.company_id,
      company_document: it.company_id ? (companyDocs[it.company_id] ?? null) : null,
      // Pool soberano: item coletivo (is_pool_item=true) recebe a lista de PJs
      // do pool para que regras de grupo/empresa consigam casar.
      pool_company_ids: it.is_pool_item === true && poolCompanyIds.length > 0
        ? poolCompanyIds
        : null,
      procedure_code: it.procedure_code,
      procedure_name: it.procedure_name,
      description: it.description,
      access_route: it.access_route,
      doctor_role: it.doctor_role,
      procedure_amount: it.procedure_amount != null ? Number(it.procedure_amount) : null,
      gross_amount: Number(it.gross_amount),
      attendance_number: it.attendance_number,
      patient_name: it.patient_name,
      procedure_date: it.procedure_date,
      procedure_date_has_time: it.procedure_date_has_time ?? false,
      quantity: it.quantity != null ? Number(it.quantity) : null,
      authorized_exception: it.authorized_exception ?? false,
      exception_reason: it.exception_reason ?? null,
      exception_authorizer: it.exception_authorizer ?? null,
      exception_note: it.exception_note ?? null,
      classification_sector: cls?.sector ?? null,
      classification_source: cls?.source ?? null,
      classification_confidence: cls?.confidence ?? null,
      tipo_linha: it.tipo_linha ?? null,
      complement_reason: it.complement_reason ?? null,
      agreement_name: it.agreement_text ?? null,
      // Especialidade MÉDICA resolvida (NÃO é o tipo_item).
      specialty: resolved.value,
      sector: recoveredSector,
      attendance_character: it.attendance_character ?? null,
      convenio_value_totalized: it.convenio_value_totalized ?? false,
      special_case_code: it.special_case_code ?? null,
      special_case_status: it.special_case_status ?? null,
      // Filtro de tipo de item por cálculo (rule_calculations.item_type_id).
      // Lê direto de payment_items.item_type_id (sync trigger da Fase B' garante
      // que essa coluna está sempre populada).
      item_type_id: (it as any).item_type_id ?? null,
      // Exceção do cálculo (LEGADO) — substituída por manual_intervention_reason_id.
      calc_exception_skip: (it as any).calc_exception_skip ?? false,
      calc_exception_skipped_calc_id: (it as any).calc_exception_skipped_calc_id ?? null,
      // Tratamento Manual (Fase 1) — motor aceita procedure_amount como esperado
      // e marca o item como aprovado, com o motivo registrado no explanation.
      manual_intervention_reason_id: (it as any).manual_intervention_reason_id ?? null,
      manual_intervention_reason_code: ((it as any).manual_intervention_reason?.code) ?? null,
      manual_intervention_reason_category: ((it as any).manual_intervention_reason?.category) ?? null,
      manual_intervention_source: (it as any).manual_intervention_source ?? null,
      // Travas do tratamento manual: acate explícito prevalece e item sem regra
      // não pode ser valorado por motivo aplicado em massa.
      gross_override_reason: (it as any).gross_override_reason ?? null,
      current_ai_status: (it as any).ai_status ?? null,
      applied_calc_method: (it as any).applied_calc_method ?? null,
      // Sub-Onda 2C — passa resolução prévia (se houver) para o motor.
      calc_duplicity_resolution: it.ai_findings?.calc_duplicity?.resolution?.chosen_calc_id
        ? { chosen_calc_id: String(it.ai_findings.calc_duplicity.resolution.chosen_calc_id) }
        : null,
    });
    });

    // ---------- 3.2 Tabelas de EXCEÇÃO vinculadas às regras (Camada 2) ----------
    // Princípio: tabelas de referência são entidades dormentes — só atuam
    // quando uma regra ATIVA as declara em `exception_table_ids`. O motor
    // recebe um lookup (tableId+code → metadados) e consulta apenas as
    // tabelas vinculadas à regra vencedora de cada item. Não há varredura
    // global — tabelas sem vínculo declarado não influenciam o cálculo.
    // Camada 2 & 3 — Tabelas de exceção.
    // 1. Tabelas explicitamente vinculadas às regras (Camada 2)
    const linkedTableIds = Array.from(new Set(
      rules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
    ));
    
    // 2. Tabelas globais (Camada 3) — todas que são 'sem_acordo' ou 'exclusao' e estão ativas
    const { data: allExcTables } = await supabase
      .from("reference_tables")
      .select("id,name,purpose,description,active,valid_from,valid_until")
      .in("purpose", ["sem_acordo", "exclusao"])
      .eq("active", true);

    const today = (ctx.reference_date ?? new Date().toISOString().slice(0, 10));
    const validGlobalIds: string[] = [];
    const exceptionTablesById: Record<string, { name: string; purpose: "sem_acordo" | "exclusao"; description: string | null }> = {};

    for (const t of (allExcTables ?? []) as any[]) {
      if (t.valid_from && t.valid_from > today) continue;
      if (t.valid_until && t.valid_until < today) continue;
      
      exceptionTablesById[t.id] = {
        name: t.name,
        purpose: t.purpose,
        description: t.description ?? null,
      };
      
      // Tabelas sem_acordo/exclusao só atuam quando vinculadas a uma regra
      // (via exception_table_ids). Nenhuma varredura global é feita.
    }

    ctx.globalExceptionTableIds = [];
    const allRelevantTableIds = Array.from(new Set(linkedTableIds));


    const exceptionItemsByTable: Record<string, Record<string, { description: string | null }>> = {};
    if (allRelevantTableIds.length > 0 && codes.length > 0) {
      const { data: excItems } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,description")
        .in("reference_table_id", allRelevantTableIds)
        .in("code", codes);
      for (const it of (excItems ?? []) as any[]) {
        const tid = it.reference_table_id as string;
        const code = String(it.code ?? "").trim();
        if (!tid || !code) continue;
        (exceptionItemsByTable[tid] ||= {})[code] = { description: it.description ?? null };
      }
    }
    const exceptionLookup = (tableId: string, code: string) => {
      const t = exceptionTablesById[tableId];
      if (!t) return null;
      const items = exceptionItemsByTable[tableId];
      const hit = items?.[String(code).trim()];
      if (!hit) return null;
      return {
        table_name: t.name,
        purpose: t.purpose,
        reason: hit.description ?? t.description ?? null,
      };
    };

    // ---------- 3.3 Tabelas de referência vinculadas a regras "tabela_diferenciada" ----------
    // Carrega valores (code → amount) de cada reference_table_id usado por regras
    // que calculam por tabela diferenciada/referência. O motor consulta esse
    // lookup; NÃO usamos `procedure_amount` quando a regra tem tabela vinculada.
    const refTableIds = Array.from(new Set([
      ...rules
        .filter((r) =>
          r.reference_table_id && (
            r.calculation_type === "tabela_diferenciada" ||
            r.calculation_type === "tabela_referencia"
          ),
        )
        .map((r) => r.reference_table_id as string),
      // Também: reference_table_id usado por itens de cálculo (1:N)
      ...rules.flatMap((r) =>
        (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
          .filter((c: any) => c.reference_table_id)
          .map((c: any) => c.reference_table_id as string),
      ),
    ]));
    const refValues: Record<string, Record<string, number>> = {};
    if (refTableIds.length > 0 && codes.length > 0) {
      const { data: refRows } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,amount,port,package_amount,role")
        .in("reference_table_id", refTableIds)
        .in("code", codes);
      for (const row of (refRows ?? []) as any[]) {
        const tid = row.reference_table_id as string;
        const code = String(row.code ?? "").trim();
        const role = row.role ? row.role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : null;
        if (!tid || !code) continue;
        const amt = row.amount != null ? Number(row.amount) : (row.package_amount != null ? Number(row.package_amount) : null);
        if (amt == null || Number.isNaN(amt)) continue;
        const key = role ? `${code}|${role}` : code;
        (refValues[tid] ||= {})[key] = amt;
      }
    }
    const referenceLookup: ReferenceTableLookup = (tableId: string, code: string, role?: string | null, forceSpecific?: boolean): number | null => {
      const t = refValues[tableId];
      if (!t) return null;
      const c = String(code).trim();

      if (role) {
        const rolesToTry: string[] = [role.toString().trim()];
        
        // Tenta encontrar o papel canônico via aliases
        const roleNorm = role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        for (const [canonical, aliases] of Object.entries(roleAliases)) {
          const normAliases = aliases.map(a => a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
          if (normAliases.includes(roleNorm)) {
            rolesToTry.push(canonical);
            break;
          }
        }

        for (const r of rolesToTry) {
          const rNorm = r.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (t[`${c}|${rNorm}`] != null) return t[`${c}|${rNorm}`];
        }
      }

      if (forceSpecific) return null;
      return t[c] ?? null;
    };

    // ---------- 4. MOTOR: decisão + cálculo determinístico ----------
    console.time(`${__t} motor_analise`);
    const siblingsSource = siblingsRaw
      ? siblingsRaw.map((r) => ({
          id: r.id,
          attendance_number: r.attendance_number ?? undefined,
          procedure_code: r.procedure_code ?? undefined,
        }) as any)
      : undefined;
    const results: AnalysisResult[] = analyzePaymentItems(items, rules, ctx, { referenceLookup, exceptionLookup, siblingsSource });
    console.timeEnd(`${__t} motor_analise`);

    // CAMADAS 1 e 2 — Gating por-regra (convênio whitelist/blacklist e
    // tabelas de exceção vinculadas) são aplicadas DENTRO do motor
    // (`analyzeItem`), sobre a regra vencedora de cada item. Cada regra é
    // uma unidade autocontida; tabelas só atuam quando vinculadas via
    // `exception_table_ids`. Não há varredura ou override global.


    const resultById: Record<string, AnalysisResult> = {};
    for (const r of results) resultById[r.item_id] = r;

    // ---------- 4.1 PACOTES por rule_calculations (package_main_code) ----------
    // Agrupa itens por attendance_number e detecta pacotes cadastrados nas regras.
    // Roda após o motor item-a-item e SOBRESCREVE o resultado onde um pacote bate.
    // Princípios:
    //   • Só atua se a regra se aplica à empresa do item (group_company_links).
    //   • Se dois pacotes batem pelo mesmo main_code → vence o de maior cobertura
    //     (mais included_codes presentes no atendimento).
    //   • Códigos absorvidos: main_code + included_codes encontrados.
    //   • Distribuição por função via package_roles_distribution (fixo ou %).
    // Itens marcados como package_absorbed em runs anteriores cujo pacote
    // ancoragem (main_code) não está mais presente no atendimento — ex.: a
    // base foi reimportada e a linha principal (Lobectomia) sumiu, deixando
    // um item incluído (Broncoscopia) "órfão" com expected=0. Coletamos aqui
    // e limpamos na persistência (rastro em audit_log via bloco existente).
    const staleAbsorbedItemIds = new Set<string>();
    // Ambiguidade de pacote (multi_anchor / no_anchor) detectada neste run.
    // Item com ambiguidade PENDENTE é neutro em economia/perda.
    const packageAmbiguityByItemId = new Map<string, Record<string, unknown>>();
    try {
      // Coleta todos os cálculos de pacote de todas as regras carregadas
      type PkgCalc = {
        rule_id: string;
        rule_name: string;
        calc_id: string;
        calc_label: string | null;
        // Lista de códigos que disparam o pacote (qualquer um deles ativa).
        package_main_codes: string[];
        package_included_codes: string[];
        package_amount: number;
        package_roles_distribution: Array<{
          role_key: string;
          label: string;
          dist_type: "pct" | "fixo";
          value: number;
        }> | null;
        rule_company_ids: Set<string>;
        rule_scope: string;
      };

      const packageCalcs: PkgCalc[] = [];
      for (const rule of rules as any[]) {
        const calcs = Array.isArray(rule.calculations) ? rule.calculations : [];
        for (const calc of calcs) {
          const isPkg =
            calc.calculation_type === "pacote" ||
            calc.calculation_type === "pacote_fechado" ||
            calc.calculation_type === "pacote_com_extras" ||
            calc.calculation_type === "pacote_por_atendimento";
          if (!isPkg || !calc.package_main_code) continue;
          const mainCodes = String(calc.package_main_code)

            .split(/[,;\s]+/)
            .map((c) => c.trim())
            .filter(Boolean);
          if (mainCodes.length === 0) continue;
          const links = Array.isArray(rule.group_company_links) ? rule.group_company_links : [];
          packageCalcs.push({
            rule_id: rule.id,
            rule_name: rule.name,
            calc_id: calc.id,
            calc_label: (calc.label ?? null) as string | null,
            package_main_codes: mainCodes,
            package_included_codes: Array.isArray(calc.package_included_codes)
              ? calc.package_included_codes.map((c: string) => String(c).trim()).filter(Boolean)
              : [],
            package_amount: Number(calc.package_amount ?? 0),
            package_roles_distribution: Array.isArray(calc.package_roles_distribution)
              ? calc.package_roles_distribution
              : null,
            rule_company_ids: new Set(links.map((l: any) => l?.company_id).filter(Boolean)),
            rule_scope: rule.scope ?? "master",
          });
        }
      }

      // Detecta absorções órfãs: rawItem.package_absorbed=true cujo calc
      // referenciado não existe mais nas regras OU cujo main_code não está
      // presente no atendimento (nem localmente, nem em outras PJs). Só
      // precisamos consultar códigos das outras PJs quando há candidatos.
      const rawAbsorbedItems = (itemsRaw ?? []).filter(
        (it: any) => it?.package_absorbed === true && it?.attendance_number,
      );
      if (rawAbsorbedItems.length > 0) {
        // Set de códigos por atendimento incluindo todas as PJs do payment.
        const attCodeSet: Record<string, Set<string>> = {};
        for (const it of (itemsRaw ?? []) as any[]) {
          const att = (it.attendance_number ?? "").toString().trim();
          const code = (it.procedure_code ?? "").toString().trim();
          if (!att || !code) continue;
          (attCodeSet[att] ||= new Set()).add(code);
        }
        try {
          const atts = Array.from(new Set(rawAbsorbedItems.map((it: any) => String(it.attendance_number).trim())));
          const { data: sibs } = await supabase
            .from("payment_items")
            .select("attendance_number,procedure_code")
            .eq("payment_id", payment_id)
            .in("attendance_number", atts)
            .not("procedure_code", "is", null);
          for (const row of (sibs ?? []) as any[]) {
            const att = (row.attendance_number ?? "").toString().trim();
            const code = (row.procedure_code ?? "").toString().trim();
            if (!att || !code) continue;
            (attCodeSet[att] ||= new Set()).add(code);
          }
        } catch { /* ignora: cai no codeSet local */ }

        const calcById = new Map<string, PkgCalc>();
        for (const c of packageCalcs) calcById.set(c.calc_id, c);

        for (const raw of rawAbsorbedItems) {
          const att = String(raw.attendance_number).trim();
          const codeSet = attCodeSet[att] ?? new Set<string>();
          const calcId = raw.package_absorbed_calc_id ?? null;
          const itemCode = String(raw.procedure_code ?? "").trim();
          // PRESERVAÇÃO DE ABSORÇÃO MANUAL: se a absorção foi feita pelo
          // analista (package_absorbed_by preenchido), é decisão soberana e
          // nunca é considerada "stale". Sem essa guarda, a reanálise
          // automática (F5/refresh) apagava marcações manuais quando não
          // havia regra de pacote correspondente no cadastro.
          const wasManual = raw.package_absorbed_by != null;
          if (wasManual) continue;
          // Sem calc_id (legado auto): considera válido se EXISTE algum
          // pacote cujo main_code está presente no atendimento E cujo
          // main/included cobre o código deste item.
          if (!calcId) {
            const anyValid = packageCalcs.some((c) => {
              const mainPresent = c.package_main_codes.some((mc) => codeSet.has(mc));
              if (!mainPresent) return false;
              return c.package_main_codes.includes(itemCode)
                || c.package_included_codes.includes(itemCode);
            });
            if (!anyValid) staleAbsorbedItemIds.add(raw.id);
            continue;
          }
          const calc = calcById.get(calcId);
          if (!calc) { staleAbsorbedItemIds.add(raw.id); continue; }
          const mainPresent = calc.package_main_codes.some((mc) => codeSet.has(mc));
          if (!mainPresent) staleAbsorbedItemIds.add(raw.id);
        }
        if (staleAbsorbedItemIds.size > 0) {
          console.log(`[pacote_rule_calcs] stale_absorbed_detected count=${staleAbsorbedItemIds.size}`);
        }
      }

      if (packageCalcs.length > 0) {
        // Helper: normaliza texto removendo acentos e caixa
        const norm = (s: string) =>
          s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        // Helper: verifica se doctor_role bate com um role_key
        const matchRole = (doctorRole: string | null | undefined, roleKey: string): boolean => {
          const r = norm(doctorRole ?? "");
          const k = norm(roleKey);
          if (k === "cirurgiao") return r.includes("cirurgi") || r.includes("principal");
          if (k === "aux1" || k === "primeiro_aux") return r.includes("primeiro") || /\b1\b/.test(r);
          if (k === "aux2" || k === "segundo_aux") return r.includes("segundo") || /\b2\b/.test(r);
          if (k === "aux3" || k === "terceiro_aux") return r.includes("terceiro") || /\b3\b/.test(r);
          if (k === "instrumentador") return r.includes("instrument");
          return r.includes(k);
        };

        const packageCoverageFor = (calc: PkgCalc, codeSet: Set<string>) => {
          const triggerCode = calc.package_main_codes.find((c) => codeSet.has(c));
          if (!triggerCode) return null;
          const includedFound = calc.package_included_codes.filter(c => codeSet.has(c));
          if (calc.package_included_codes.length > 0 && includedFound.length === 0) return null;
          return { triggerCode, includedFound };
        };

        // Agrupa itens por attendance_number (sem attendance não participa de pacote)
        const byAttendance: Record<string, typeof items> = {};
        for (const it of items) {
          const att = (it.attendance_number ?? "").toString().trim();
          if (!att) continue;
          (byAttendance[att] ||= []).push(it);
        }

        // Fix cross-PJ: cada worker vê só os itens da sua empresa. Em pacotes onde
        // os códigos se distribuem por múltiplas PJs (ex.: Cirurgião na SALUTAIRE,
        // Auxiliares na THORAX), o codeSet local não tem o main_code → o pacote não
        // casa. Solução: para cada attendance_number desta empresa, buscar todos os
        // procedure_codes do payment (todas as PJs) e usar esse codeSet expandido
        // apenas para matching. A distribuição por função continua aplicada só nos
        // itens da empresa corrente (attItems).
        const crossPjCodeSetByAtt: Record<string, Set<string>> = {};
        const attNumbers = Object.keys(byAttendance);
        if (attNumbers.length > 0) {
          try {
            const { data: siblingRows } = await supabase
              .from("payment_items")
              .select("attendance_number,procedure_code")
              .eq("payment_id", payment_id)
              .in("attendance_number", attNumbers)
              .not("procedure_code", "is", null);
            for (const row of (siblingRows ?? []) as any[]) {
              const att = (row.attendance_number ?? "").toString().trim();
              const code = (row.procedure_code ?? "").toString().trim();
              if (!att || !code) continue;
              if (!crossPjCodeSetByAtt[att]) crossPjCodeSetByAtt[att] = new Set<string>();
              crossPjCodeSetByAtt[att].add(code);
            }
          } catch (crossPjErr) {
            console.warn("[pacote_rule_calcs] cross-PJ query falhou, usando codeSet local:", (crossPjErr as any)?.message ?? crossPjErr);
          }
        }

        for (const [att, attItems] of Object.entries(byAttendance)) {
          // codeSet expandido: inclui códigos de outras PJs do mesmo atendimento.
          // Fallback para codeSet local se a query cross-PJ não rodou.
          const localCodeSet = new Set(
            attItems.map(it => (it.procedure_code ?? "").toString().trim()).filter(Boolean),
          );
          const fullCodeSet = crossPjCodeSetByAtt[att] ?? localCodeSet;

          // MULTI-PACOTE SEM AUTO-ABSORÇÃO:
          // Regra de produto: o pacote só aplica seu valor consolidado sobre o
          // CÓDIGO ÂNCORA (package_main_code presente no atendimento). Os demais
          // códigos do atendimento — mesmo que estejam em package_included_codes
          // — continuam sendo cruzados normalmente pelo motor (linhas comuns,
          // tabela diferenciada, excedente etc.). A absorção real só acontece
          // quando o analista marca manualmente `package_absorbed = true` na UI.
          //
          // Assim, um mesmo atendimento pode receber múltiplos pacotes (um por
          // âncora distinta) e ainda manter cálculos independentes para os
          // códigos avulsos que sobraram.
          const attCompanyIds = new Set(attItems.map(it => it.company_id).filter(Boolean));
          const usedCalcIds = new Set<string>();

          // Candidatos: todo calc cujo main_code aparece no atendimento.
          const candidates: Array<{
            calc: PkgCalc;
            triggerCode: string;
            includedFound: string[];
          }> = [];
          for (const calc of packageCalcs) {
            const triggerCode = calc.package_main_codes.find(c => fullCodeSet.has(c));
            if (!triggerCode) continue;
            if (calc.rule_scope === "grupo" && calc.rule_company_ids.size > 0) {
              const appliesToCompany = [...attCompanyIds].some(cid => calc.rule_company_ids.has(cid));
              if (!appliesToCompany) continue;
            }
            const includedFound = calc.package_included_codes.filter(c => fullCodeSet.has(c));
            candidates.push({ calc, triggerCode, includedFound });
          }

          // Desempate por âncora: dentro do MESMO trigger code escolhe o mais específico
          // (maior coverage de included presentes; em empate, mais included declarados).
          const byTrigger: Record<string, typeof candidates> = {};
          for (const c of candidates) (byTrigger[c.triggerCode] ||= []).push(c);
          let winners: typeof candidates = [];
          for (const list of Object.values(byTrigger)) {
            list.sort((a, b) => {
              if (b.includedFound.length !== a.includedFound.length) return b.includedFound.length - a.includedFound.length;
              return b.calc.package_included_codes.length - a.calc.package_included_codes.length;
            });
            winners.push(list[0]);
          }

          // ---- Desempate entre ÂNCORAS DISTINTAS por VIA DE ACESSO (caso THORAX) ----
          // Dois códigos-alavanca diferentes no mesmo atendimento não podem gerar
          // dois pacotes automaticamente. Vence a via "Única ou principal"; os
          // demais viram decisão do analista (neutros — nem economia nem perda).
          if (winners.length > 1) {
            const routeOf = (code: string): string => {
              const hit = attItems.find(
                (i) => (i.procedure_code ?? "").toString().trim() === code,
              );
              return normAccessRoute((hit as any)?.access_route ?? null) as string;
            };
            const ranked = rankAnchorsByAccessRoute(
              winners.map((w) => ({ ...w, routeKey: routeOf(w.triggerCode) })) as AnchorCandidate[],
            );
            if (ranked.ambiguous.length > 0) {
              const optionOf = (c: AnchorCandidate) => ({
                calc_id: c.calc.calc_id,
                rule_id: c.calc.rule_id,
                rule_name: c.calc.rule_name,
                calc_label: c.calc.calc_label,
                code: c.triggerCode,
                package_amount: c.calc.package_amount,
                included_codes: c.calc.package_included_codes,
                access_route: c.routeKey || null,
              });
              const options = [
                ...(ranked.winner ? [optionOf(ranked.winner)] : []),
                ...ranked.ambiguous.map(optionOf),
              ];
              for (const amb of ranked.ambiguous) {
                for (const it of attItems) {
                  const code = (it.procedure_code ?? "").toString().trim();
                  if (code !== amb.triggerCode) continue;
                  const rawIt = (itemsRaw ?? []).find((x: any) => x.id === it.id);
                  // Decisão do analista é soberana — não reabre ambiguidade resolvida.
                  if (rawIt?.package_ambiguity?.resolved) continue;
                  const r = resultById[it.id];
                  if (!r) continue;
                  // NEUTRO: expected = pago → delta zero, não conta economia/perda.
                  r.expected_amount = it.gross_amount;
                  r.diff_pct = 0;
                  r.status = "alerta" as any;
                  r.needs_ai_review = false;
                  (r as any).package_absorbed = false;
                  (r as any).package_absorbed_calc_id = null;
                  r.alerts = [
                    `Pacote ambíguo: o atendimento ${att} tem mais de um código-alavanca (${options.map((o) => o.code).join(", ")}). Decisão do analista pendente.`,
                    ...r.alerts.filter((a) => !a.toLowerCase().includes("sem regra")),
                  ];
                  r.calculation_explanation =
                    `Atendimento ${att}: o motor encontrou ${options.length} pacotes candidatos. ` +
                    (ranked.winner
                      ? `Aplicado automaticamente o pacote do código ${ranked.winner.triggerCode} (via "${ranked.winner.routeKey || "—"}"). `
                      : `Empate na via de acesso — nenhum pacote foi aplicado automaticamente. `) +
                    `O código ${amb.triggerCode} (via "${amb.routeKey || "—"}") ficou pendente de decisão: absorver no pacote, pagar avulso ou outro valor. ` +
                    `Enquanto pendente, este item é neutro (não gera economia nem perda).`;
                  packageAmbiguityByItemId.set(it.id, {
                    kind: "multi_anchor",
                    att,
                    item_code: amb.triggerCode,
                    chosen_calc_id: ranked.winner?.calc.calc_id ?? null,
                    chosen_code: ranked.winner?.triggerCode ?? null,
                    options,
                    detected_at: new Date().toISOString(),
                  });
                }
              }
            }
            winners = ranked.winner ? [ranked.winner] : [];
          }

          // ---- Pacote SEM código-alavanca (caso AGATHA) ----
          // Nenhum main_code foi faturado, mas os códigos do atendimento
          // pertencem a package_included_codes de algum pacote. Não altera
          // valor: só sinaliza a sugestão e neutraliza economia/perda.
          if (candidates.length === 0) {
            const suggestions = findPackagesWithoutAnchor(packageCalcs, fullCodeSet, attCompanyIds, 3);
            if (suggestions.length > 0) {
              const suggestionPayload = suggestions.map((s) => ({
                calc_id: s.calc.calc_id,
                rule_id: s.calc.rule_id,
                rule_name: s.calc.rule_name,
                calc_label: s.calc.calc_label,
                main_codes: s.calc.package_main_codes,
                package_amount: s.calc.package_amount,
                matched_included: s.matchedIncluded,
              }));
              const coveredCodes = new Set(suggestions.flatMap((s) => s.matchedIncluded));
              for (const it of attItems) {
                const code = (it.procedure_code ?? "").toString().trim();
                if (!coveredCodes.has(code)) continue;
                const rawIt = (itemsRaw ?? []).find((x: any) => x.id === it.id);
                if (rawIt?.package_ambiguity?.resolved) continue;
                if (rawIt?.package_absorbed === true) continue;
                const r = resultById[it.id];
                if (!r) continue;
                // Mantém o cálculo avulso já produzido pelo motor; só sinaliza.
                r.status = "alerta" as any;
                r.needs_ai_review = false;
                r.alerts = [
                  `Códigos deste atendimento pertencem ao pacote "${suggestions[0].calc.rule_name}", mas nenhum código-alavanca foi faturado. Decisão do analista pendente.`,
                  ...r.alerts,
                ];
                r.calculation_explanation =
                  `${r.calculation_explanation ?? ""} ` +
                  `Atendimento ${att}: o código ${code} está declarado em package_included_codes de ` +
                  `${suggestions.map((s) => `"${s.calc.rule_name}"`).join(", ")}, porém o código-alavanca ` +
                  `(${suggestions[0].calc.package_main_codes.join(" / ")}) não aparece na base. ` +
                  `Item mantido com cálculo avulso e marcado como neutro até a decisão do analista.`;
                packageAmbiguityByItemId.set(it.id, {
                  kind: "no_anchor",
                  att,
                  item_code: code,
                  suggestions: suggestionPayload,
                  detected_at: new Date().toISOString(),
                });
              }
            }
          }


          for (const { calc, triggerCode, includedFound } of winners) {
            if (usedCalcIds.has(calc.calc_id)) continue;
            usedCalcIds.add(calc.calc_id);

            // Âncora (triggerCode) recebe a distribuição do pacote.
            // Itens cujo code está em package_included_codes são AUTO-absorvidos
            // pelo motor (foram declarados pelo analista na regra como parte do
            // pacote → expected=0, aprovado). Demais códigos do atendimento só
            // ficam absorvidos se o analista clicar manualmente no painel.
            const includedSet = new Set(calc.package_included_codes.map((c) => String(c).trim()));
            const absorbedCodes = new Set([triggerCode, ...includedFound]);
            const primaryItemByRole = buildPrimaryItemByRole(attItems as any, new Set([triggerCode]), triggerCode);

            for (const it of attItems) {
              const code = (it.procedure_code ?? "").toString().trim();
              const rawIt = (itemsRaw ?? []).find((x: any) => x.id === it.id);
              const manuallyAbsorbed = rawIt?.package_absorbed === true;
              const autoAbsorbed = code !== triggerCode && includedSet.has(code);

              // Só toca em: (a) âncora, (b) auto-absorvido pela regra, ou (c) manual.
              if (code !== triggerCode && !autoAbsorbed && !manuallyAbsorbed) continue;
              if (manuallyAbsorbed && code !== triggerCode && !absorbedCodes.has(code)) continue;

              const r = resultById[it.id];
              if (!r) continue;

              if ((autoAbsorbed || manuallyAbsorbed) && code !== triggerCode) {
                r.matched_rule_id = calc.rule_id;
                r.matched_rule_name = `${calc.rule_name} — Pacote`;
                (r as any).calculation_type_used = "pacote";
                r.matched_priority = "match";
                r.expected_amount = 0;
                r.diff_pct = null;
                r.status = "aprovado" as any;
                r.needs_ai_review = false;
                (r as any).package_absorbed = true;
                (r as any).package_absorbed_calc_id = calc.id ?? null;
                r.alerts = r.alerts.filter((a) =>
                  !a.toLowerCase().includes("sem regra") && !a.toLowerCase().includes("no rule"),
                );
                r.calculation_explanation = autoAbsorbed
                  ? `Atendimento ${att}: código ${code} absorvido automaticamente pelo pacote ${triggerCode} (${calc.rule_name}) — declarado em package_included_codes.`
                  : `Atendimento ${att}: código ${code} absorvido manualmente pelo analista no pacote ${triggerCode} (${calc.rule_name}).`;
                continue;
              }

              // Item âncora: recebe a distribuição do pacote por função.
              r.matched_rule_id = calc.rule_id;
              r.matched_rule_name = `${calc.rule_name} — Pacote`;
              (r as any).calculation_type_used = "pacote";
              r.matched_priority = "match";

              const isPrimary = isPrimaryAnchor(it as any, primaryItemByRole);
              let expectedAmt: number | null = null;
              if (isPrimary && calc.package_roles_distribution && calc.package_roles_distribution.length > 0) {
                const dist = calc.package_roles_distribution.find(d => matchRole(it.doctor_role, d.role_key));
                if (dist) {
                  expectedAmt = dist.dist_type === "fixo"
                    ? Number(dist.value)
                    : (Number(dist.value) / 100) * calc.package_amount;
                }
              }

              r.expected_amount = expectedAmt;
              r.diff_pct = expectedAmt && expectedAmt > 0
                ? ((it.gross_amount - expectedAmt) / expectedAmt) * 100
                : null;

              if (expectedAmt !== null) {
                if (Math.abs(it.gross_amount - expectedAmt) <= 0.02) {
                  r.status = "aprovado" as any;
                  r.needs_ai_review = false;
                  r.alerts = r.alerts.filter((a) =>
                    !a.toLowerCase().includes("sem regra") && !a.toLowerCase().includes("no rule"),
                  );
                } else {
                  r.status = "alerta" as any;
                  r.needs_ai_review = true;
                  const diff = it.gross_amount - expectedAmt;
                  r.alerts = [
                    `Pacote (${triggerCode}): esperado R$ ${expectedAmt.toFixed(2)}, pago R$ ${it.gross_amount.toFixed(2)} (${diff > 0 ? "+" : ""}${diff.toFixed(2)}).`,
                    ...r.alerts.filter(a => !a.toLowerCase().includes("sem regra")),
                  ];
                }
              } else {
                r.status = "alerta" as any;
                r.needs_ai_review = true;
                r.alerts = [
                  `Pacote detectado (${triggerCode}), mas sem distribuição configurada para a função "${it.doctor_role ?? "—"}". Configure package_roles_distribution nesta regra.`,
                  ...r.alerts.filter(a => !a.toLowerCase().includes("sem regra")),
                ];
              }

              r.calculation_explanation =
                `Atendimento ${att}: pacote identificado pelo código âncora ${triggerCode} ` +
                `(${calc.rule_name}). Valor total do pacote: R$ ${calc.package_amount.toFixed(2)}. ` +
                `Códigos elegíveis para absorção manual: ${calc.package_included_codes.join(", ") || "—"}.` +
                (expectedAmt !== null ? ` Esperado para "${it.doctor_role}": R$ ${expectedAmt.toFixed(2)}.` : "");
            }
          }
        }

      }
    } catch (pkgErr) {
      console.error("[pacote_rule_calcs] falha:", pkgErr);
    }

    // ---------- 4.2 PACOTES FIXOS por combinação de códigos ----------
    // Tabelas reference_tables.kind = 'pacote_combinacao' SÓ atuam quando
    // estiverem vinculadas a alguma regra ativa (via reference_table_id da
    // regra, reference_table_id de um cálculo, ou exception_table_ids).
    // Tabela sem regra vinculada não tem poder algum — a regra manda.
    try {
      const today = (ctx.reference_date ?? new Date().toISOString().slice(0, 10));
      const ruleLinkedTableIds = new Set<string>([
        ...rules.filter((r) => r.reference_table_id).map((r) => r.reference_table_id as string),
        ...rules.flatMap((r) =>
          (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
            .filter((c: any) => c.reference_table_id)
            .map((c: any) => c.reference_table_id as string),
        ),
        ...rules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
      ]);
      if (ruleLinkedTableIds.size === 0) {
        // Nenhuma regra ativa referencia tabela alguma → não há pacote a aplicar.
        // (early-out evita query desnecessária)
      }
      const { data: pkgTablesAll } = ruleLinkedTableIds.size === 0 ? { data: [] as any[] } : await supabase
        .from("reference_tables")
        .select("id,name,active,valid_from,valid_until,package_only_main_surgeon,package_apply_auxiliaries,package_apply_particular,package_apply_intl_insurance")
        .eq("kind", "pacote_combinacao")
        .eq("active", true)
        .in("id", Array.from(ruleLinkedTableIds));
      const pkgTables = (pkgTablesAll ?? []).filter((t: any) =>
        (!t.valid_from || t.valid_from <= today) && (!t.valid_until || t.valid_until >= today),
      );
      if (pkgTables.length > 0) {
        const pkgIds = pkgTables.map((t: any) => t.id);
        const { data: pkgItems } = await supabase
          .from("reference_table_items")
          .select("id,reference_table_id,package_id,tuss_codes,package_amount,description")
          .in("reference_table_id", pkgIds);

        const byAttendance: Record<string, typeof items> = {};
        for (const it of items) {
          const k = (it.attendance_number ?? "").toString().trim() || `__no_att__${it.id}`;
          (byAttendance[k] ||= []).push(it);
        }
        const tableById: Record<string, any> = {};
        for (const t of pkgTables) tableById[(t as any).id] = t;

        const isAuxRole = (role: string | null | undefined) => {
          const s = (role ?? "").toLowerCase();
          return s.includes("aux") || s.includes("instrument");
        };

        for (const attItems of Object.values(byAttendance)) {
          const codeSet = new Set(
            attItems.map((i) => (i.procedure_code ?? "").toString().trim()).filter(Boolean),
          );
          if (codeSet.size === 0) continue;

          for (const pkg of (pkgItems ?? []) as any[]) {
            const required: string[] = (pkg.tuss_codes ?? []).map((c: string) => String(c).trim()).filter(Boolean);
            if (required.length === 0) continue;
            if (!required.every((c) => codeSet.has(c))) continue;

            const cfg = tableById[pkg.reference_table_id];
            const eligible = attItems.filter((i) => {
              const code = (i.procedure_code ?? "").toString().trim();
              if (!required.includes(code)) return false;
              const role = i.doctor_role ?? "";
              if (cfg?.package_only_main_surgeon && isAuxRole(role)) return false;
              if (!cfg?.package_apply_auxiliaries && isAuxRole(role)) return false;
              return true;
            });
            if (eligible.length === 0) continue;

            const pkgAmount = Number(pkg.package_amount ?? 0);
            const perItem = pkgAmount / eligible.length;

            for (const it of eligible) {
              const r = resultById[it.id];
              if (!r || r.calculation_type_used === "exclusao") continue;
              r.expected_amount = perItem;
              r.diff_pct = perItem ? ((it.gross_amount - perItem) / perItem) * 100 : null;
              r.matched_rule_id = null;
              r.matched_rule_name = `Pacote: ${cfg?.name ?? "—"} · ${pkg.package_id ?? ""}`;
              r.matched_priority = "conflito";
              r.calculation_type_used = "pacote_fixo";
              r.calculation_explanation =
                `Combinação ${required.join(" + ")} corresponde ao pacote "${pkg.package_id ?? ""}" ` +
                `da tabela "${cfg?.name ?? ""}". Valor fixo R$ ${pkgAmount.toFixed(2)} ` +
                `rateado entre ${eligible.length} item(ns) = R$ ${perItem.toFixed(2)} cada.`;
              const diff = it.gross_amount - perItem;
              if (Math.abs(diff) <= 0.01) {
                r.status = "aprovado" as any;
                r.needs_ai_review = false;
              } else {
                r.status = "alerta" as any;
                r.needs_ai_review = true;
                r.alerts = [
                  `Pacote fixo "${pkg.package_id ?? ""}": esperado R$ ${perItem.toFixed(2)}, pago R$ ${it.gross_amount.toFixed(2)}.`,
                  ...r.alerts,
                ];
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[pacote_combinacao] falha:", e);
    }

    // ---------- 5. IA SÓ JUSTIFICA itens com needs_ai_review ----------
    // Em modo empresa_prioritaria, ignoramos histórico de outros pagamentos.
    // Modo confecção: o sistema GEROU os valores via regras — não há divergência a revisar.
    // Todos os itens saem como aprovado; IA de justificativa não é acionada.
    if (isConfeccao) {
      for (const r of results) {
        r.status = "aprovado" as any;
        r.needs_ai_review = false;
        r.alerts = [];
      }
    }
    const itemsToReview = __skip_ai || is_dry_run || isConfeccao ? [] : results.filter((r) => r.needs_ai_review).slice(0, 200);
    __telemetry.ai_items_count = itemsToReview.length;
    const __aiStart = Date.now();
    let aiJustifications: Record<string, { extra_alerts: string[]; ai_note: string; ai_fallback?: boolean }> = {};
    const AI_FALLBACK_LEGACY_PREFIX = "Justificativa automática indisponível";
    // Hash canônico do payload da IA por item (short-circuit de cache).
    // Populado abaixo mesmo em cache hit para persistir em payment_items depois.
    const hashByItemId: Record<string, string> = {};
    const cachedItemIds = new Set<string>();
    // LGPD: reverseMap por item para re-hidratar tokens PACIENTE_N devolvidos
    // pela IA. Nunca persistido — vive só nesta request.
    const reverseMapByItemId: Record<string, ReverseMap> = {};

    console.time(`${__t} chamada_ia`);
    if (itemsToReview.length > 0) {
      let itemsForAi = itemsToReview.map((r) => {
        const it = items.find((i) => i.id === r.item_id)!;
        // Pseudonimiza paciente ANTES de qualquer hash/envio. Mascaramento
        // é PER-ITEM (não por batch) para que o mesmo item gere o mesmo
        // token independente dos vizinhos e o cache de hash continue estável.
        const raw = {
          id: r.item_id,
          empresa: it.company_name,
          atendimento: it.attendance_number,
          paciente: it.patient_name,
          medico: it.doctor_name,
          funcao: it.doctor_role,
          codigo: it.procedure_code,
          procedimento: it.procedure_name ?? it.description,
          via_acesso: it.access_route,
          valor_convenio: it.procedure_amount,
          valor_pago: it.gross_amount,
          motor: {
            status: r.status,
            valor_esperado: r.expected_amount,
            diff_pct: r.diff_pct,
            regra_vencedora: r.matched_rule_name,
            tipo_calculo: r.calculation_type_used,
            prioridade: r.matched_priority,
            explicacao: r.calculation_explanation,
            alertas_motor: r.alerts,
            grupo_atendimento: r.attendance_group_key,
            procedimento_principal: r.is_main_procedure,
            motivo_principal: r.main_reason,
            principal_ambiguo: r.main_ambiguous,
          },
        };
        const { masked, reverseMap } = maskPatients(raw);
        reverseMapByItemId[r.item_id] = reverseMap;
        return masked;
      });


      // ============ Cache determinístico da IA (short-circuit por hash) ============
      // Se o payload EXATO já foi analisado antes (mesmo item / mesmo motor /
      // mesma versão de regras / mesmos irmãos do atendimento / mesma versão
      // de prompt), reusamos ai_note + extra_alerts em vez de queimar créditos.
      //
      // Correção do hash:
      //  - Derivado do PRÓPRIO objeto itemForAi (canonicalStringify) — se um
      //    campo novo entrar em itemForAi, entra no hash automaticamente.
      //  - Snapshot do resultado do motor (status/expected/rule_id/alerts).
      //  - Digest dos irmãos do mesmo attendance_number (a IA é instruída a
      //    detectar duplicidade no atendimento — mudar um irmão pode mudar
      //    a análise deste item).
      //  - rules.updated_at máximo do hospital.
      //  - AI_PROMPT_VERSION (bumpar ao mudar prompt/schema/shape do payload).
      //
      // _force_fresh=true bypassa o cache mas AINDA grava o hash novo,
      // mantendo o próximo run elegível a reuso.

      try {
        const engineSnapshotById: Record<string, EngineSnapshot> = {};
        for (const r of itemsToReview) {
          engineSnapshotById[r.item_id] = {
            status: (r.status as string) ?? null,
            expected_amount: r.expected_amount ?? null,
            matched_rule_id: r.matched_rule_id ?? null,
            alerts: Array.isArray(r.alerts) ? r.alerts : [],
          };
        }

        // Irmãos do atendimento — query slim sobre TODOS os itens do payment
        // (não só desta empresa) que compartilham attendance_number com algum
        // item que vai à IA. Attendance cruza empresas em cirurgias com
        // múltiplos participantes; ignorar isso deixaria o hash cego a esses
        // vínculos e reusaria análise obsoleta.
        const attendanceNums = Array.from(new Set(
          itemsForAi.map((i) => i.atendimento).filter((v): v is string => !!v)
        ));
        const siblingsByAttendance: Record<string, SiblingItem[]> = {};
        if (attendanceNums.length > 0) {
          const { data: sibRows } = await supabase
            .from("payment_items")
            .select("id, attendance_number, procedure_code, doctor_role, gross_amount, procedure_amount")
            .eq("payment_id", payment_id)
            .in("attendance_number", attendanceNums);
          for (const s of (sibRows ?? []) as any[]) {
            const key = (s.attendance_number ?? "") as string;
            (siblingsByAttendance[key] ||= []).push({
              id: s.id,
              procedure_code: s.procedure_code ?? null,
              doctor_role: s.doctor_role ?? null,
              gross_amount: s.gross_amount ?? null,
              procedure_amount: s.procedure_amount ?? null,
            });
          }
        }

        // rules.updated_at máximo aplicável ao hospital do payment.
        let rulesUpdatedAt: string | null = null;
        try {
          let rq = supabase.from("rules").select("updated_at").order("updated_at", { ascending: false }).limit(1);
          if (__paymentHospitalId) {
            rq = rq.or(`hospital_id.is.null,hospital_id.eq.${__paymentHospitalId}`);
          }
          const { data: ruMax } = await rq;
          rulesUpdatedAt = ((ruMax?.[0] as any)?.updated_at as string) ?? null;
        } catch (_) { /* null → hash muda mais frequente; nunca corrompe */ }

        // Calcula hash de cada item (persiste em hashByItemId).
        for (const item of itemsForAi) {
          const eng = engineSnapshotById[item.id];
          const rawSiblings = siblingsByAttendance[(item.atendimento ?? "") as string] ?? [];
          const siblingsExcludingSelf = rawSiblings.filter((s) => s.id !== item.id);
          const siblingsDigest = await buildSiblingsDigest(siblingsExcludingSelf);
          hashByItemId[item.id] = await buildAiInputHash({
            itemForAi: item,
            engineSnapshot: eng,
            rulesUpdatedAt,
            siblingsDigest,
          });
        }

        // Lookup do cache: itens prévios com o mesmo hash e ai_findings.engine.ai_note preenchido.
        // Pula linhas marcadas como fallback (ai_fallback=true) e o legado com o
        // prefixo determinístico — fallback nunca pode virar "análise real" via cache.
        if (!__force_fresh) {
          const hashList = Array.from(new Set(Object.values(hashByItemId).filter(Boolean)));
          if (hashList.length > 0) {
            const { data: cacheRows } = await supabase
              .from("payment_items")
              .select("id, ai_input_hash, ai_findings")
              .in("ai_input_hash", hashList)
              .not("ai_findings", "is", null)
              .limit(hashList.length * 3);
            const cacheByHash: Record<string, { ai_note: string; extra_alerts: string[] }> = {};
            for (const row of (cacheRows ?? []) as any[]) {
              const h = row.ai_input_hash as string;
              if (!h || cacheByHash[h]) continue;
              const engineBlock = row.ai_findings?.engine;
              if (engineBlock?.ai_fallback === true) continue;
              const note = typeof engineBlock?.ai_note === "string" ? engineBlock.ai_note : null;
              if (!note) continue;
              if (note.startsWith(AI_FALLBACK_LEGACY_PREFIX)) continue;
              // extra_alerts não é persistido separadamente hoje; cache preserva
              // apenas a nota. Alerts do motor são recomputados a cada análise.
              const extras: string[] = [];
              cacheByHash[h] = { ai_note: note, extra_alerts: extras };
            }
            const missing: typeof itemsForAi = [];
            for (const item of itemsForAi) {
              const h = hashByItemId[item.id];
              const hit = h ? cacheByHash[h] : undefined;
              if (hit) {
                aiJustifications[item.id] = { extra_alerts: hit.extra_alerts, ai_note: hit.ai_note };
                cachedItemIds.add(item.id);
              } else {
                missing.push(item);
              }
            }
            __telemetry.ai_items_skipped_cache = cachedItemIds.size;
            if (cachedItemIds.size > 0) {
              console.log(`${__t} ai_cache_hit=${cachedItemIds.size}/${itemsForAi.length} (economia de créditos IA)`);
            }
            itemsForAi = missing;
          }
        } else {
          console.log(`${__t} ai_cache_bypass (_force_fresh=true)`);
        }
      } catch (cacheErr) {
        // Nunca deixe a falha do cache derrubar a análise: loga e segue com IA normal.
        console.warn(`${__t} ai_cache_lookup falhou (não bloqueante):`, (cacheErr as any)?.message ?? cacheErr);
      }
      // ============ Fim do short-circuit ============


      const historyText = isEmpresaPrioritaria ? "" : await (async () => {
        const { data: history } = await supabase
          .from("payment_observations")
          .select("author_type, message")
          .in("author_type", ["analista", "validador", "diretor"])
          .order("created_at", { ascending: false })
          .limit(30);
        if (!history?.length) return "";
        return "\n\nObservações recentes de analistas/validadores/diretor (contexto):\n" +
          history.map((h: any) => `- (${h.author_type}) ${h.message}`).join("\n");
      })();

      const correctionContext = isEmpresaPrioritaria ? "" : await (async () => {
        try {
          const since = new Date();
          since.setDate(since.getDate() - 90);
          const { data: acatados } = await supabase
            .from("payment_items")
            .select("procedure_code, company_name")
            .eq("ai_status", "acatado")
            .gte("created_at", since.toISOString())
            .limit(200);
          if (!acatados?.length) return "";
          const counts: Record<string, { code: string; company: string; count: number }> = {};
          for (const row of acatados as any[]) {
            const code = (row.procedure_code ?? "").toString().trim();
            const company = (row.company_name ?? "").toString().trim();
            if (!code || !company) continue;
            const key = `${code}||${company}`;
            (counts[key] ||= { code, company, count: 0 }).count++;
          }
          const top = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10);
          if (top.length === 0) return "";
          return "\n\nPadrões historicamente corrigidos pelo analista nos últimos 90 dias (aprenda com isso — evite re-alertar casos análogos):\n" +
            top.map((t) => `- ${t.code} em "${t.company}": acatado ${t.count}x`).join("\n");
        } catch {
          return "";
        }
      })();

      const systemPrompt = `Você é um auditor de pagamentos médicos. 
MOTOR DETERMINÍSTICO já decidiu a regra e o valor. Sua missão é APONTAR FALHAS DE LÓGICA ou VÍNCULOS DIVERGENTES.
- O médico pertence à empresa? 
- O procedimento faz sentido para o contexto?
- Identifique duplicidades de cobrança no mesmo atendimento.
- Setor é filtro OPCIONAL. Nunca peça para cadastrar setor se a regra não o exige.
- SETOR DA PLANILHA É VERDADE: a coluna "Setor" enviada pelo analista é fonte de verdade. NUNCA infira setor pelo tipo de procedimento (ex.: cateterismo → "deve ser Centro Cirúrgico") nem sobrescreva o que está declarado. Se o setor declarado parecer inconsistente com o procedimento, apenas registre como observação informativa — jamais como alerta de regra ou divergência de cálculo.
NUNCA mude status ou valores. Sua saída auxilia a decisão humana.
${isEmpresaPrioritaria ? "MODO EMPRESA_PRIORITÁRIA: analise cada item ISOLADAMENTE." : ""}${correctionContext}${historyText}`;

      // A IA é apenas justificativa textual; o motor determinístico já decidiu.
      // CHUNKS PARALELOS COM RETRY: empresas grandes (>15 itens) eram quebradas em
      // chunks SEQUENCIAIS, acumulando timeouts (60s × N chunks → estouro do limite
      // de 150s da edge function) e perdendo a IA de empresas inteiras em silêncio.
      //
      // Mudanças contra o "trava e some" relatado em produção:
      //  1. AI_CHUNK_SIZE 25→15: payload menor = resposta mais rápida e menos provável
      //     de bater o timeout de upstream do Anthropic.
      //  2. AI_TIMEOUT_MS 60s→90s: extended-thinking do Claude às vezes passa de 60s;
      //     abortar cedo só forçava retry desnecessário.
      //  3. AI_MAX_RETRIES=1 por chunk em AbortError/erro de rede: a maioria dos
      //     timeouts é transitória e sucede na segunda tentativa.
      //  4. Concorrência AI_CHUNK_CONCURRENCY=3: chunks rodam em paralelo limitado.
      //     Reduz tempo total da IA proporcionalmente sem sobrecarregar o Anthropic.
      //  5. Telemetria por chunk + aviso no summary: falha parcial agora aparece
      //     em analysis_telemetry (ai_chunks_failed) e como prefixo no resumo
      //     entregue ao usuário ("⚠️ N de M chunks da IA falharam — justificativas
      //     incompletas"). Antes a falha era 100% silenciosa.
      // 2026-06-24: IASO (85 itens, 75s de IA) chegou a 146s — a 4s do limite
      // de 150s da edge function. Aumentamos a concorrência de 3→5 para reduzir
      // o número de "ondas" sequenciais; chunk size mantido em 15 (menor =
      // mais chunks = mais round-trips). 5 × 15 = 75 itens em paralelo na
      // primeira onda, suficiente para empresas grandes terminarem em 1-2
      // ondas em vez de 3.
      const AI_CHUNK_SIZE = 15;
      const AI_TIMEOUT_MS = 90_000;
      const AI_MAX_RETRIES = 1;
      const AI_CHUNK_CONCURRENCY = 5;

      const aiChunks: typeof itemsForAi[] = [];
      for (let i = 0; i < itemsForAi.length; i += AI_CHUNK_SIZE) {
        aiChunks.push(itemsForAi.slice(i, i + AI_CHUNK_SIZE));
      }
      __telemetry.ai_chunks_total = aiChunks.length;
      const summaries: string[] = [];

      // Roda UM chunk com retry em AbortError/erro de rede. Erros 4xx/5xx do
      // Anthropic NÃO são tratados como retry — passar pelo retry só ajuda
      // em falha transitória (timeout/rede); erro persistente fica registrado.
      const applyAiUnavailableFallback = (chunk: typeof itemsForAi[number], reason: string) => {
        for (const item of chunk) {
          aiJustifications[item.id] = {
            extra_alerts: [],
            ai_note: `${AI_FALLBACK_LEGACY_PREFIX} (${reason}). Decisão mantida pelo motor determinístico.`,
            ai_fallback: true,
          };
        }
        summaries.push(`IA indisponível em parte da análise (${reason}); valores e status foram mantidos pelo motor determinístico.`);
      };

      const runChunk = async (chunk: typeof itemsForAi[number], ci: number): Promise<boolean> => {
        for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
          const aiAbort = new AbortController();
          const aiTimer = setTimeout(() => aiAbort.abort(), AI_TIMEOUT_MS);
          let aiResp: Response | null = null;
          try {
            aiResp = await anthropicFetch({
              model: "claude-sonnet-4-5",
              max_tokens: 4096,
              system: systemPrompt,
              messages: [
                { role: "user", content: `Itens marcados pelo motor (JSON) — chunk ${ci + 1}/${aiChunks.length}:\n${JSON.stringify(chunk, null, 2)}` },
              ],
              tools: [{
                name: "report_justifications",
                description: "Justifica cada item já analisado pelo motor",
                input_schema: {
                  type: "object",
                  properties: {
                    summary: { type: "string", description: "Resumo OBJETIVO em pt-BR, máx. 2 frases, focado no que o gestor precisa decidir." },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          ai_note: { type: "string", description: "Justificativa curta do alerta/reprovação." },
                          extra_alerts: { type: "array", items: { type: "string" }, description: "Alertas EXTRAS que o motor não capturou. Vazio se nada a acrescentar." },
                        },
                        required: ["id", "ai_note", "extra_alerts"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["summary", "items"],
                  additionalProperties: false,
                },
              }],
              tool_choice: { type: "tool", name: "report_justifications" },
            }, { signal: aiAbort.signal });


            if (aiResp.ok) {
              const aiData = await aiResp.json();
              const tc = aiData.content?.find((b: any) => b.type === "tool_use");
              if (tc) {
                const parsed = tc.input;
                for (const it of parsed.items ?? []) {
                  // Re-hidrata PACIENTE_N com o nome real antes de gravar/exibir.
                  const rmap = reverseMapByItemId[it.id] ?? {};
                  aiJustifications[it.id] = {
                    extra_alerts: Array.isArray(it.extra_alerts)
                      ? it.extra_alerts.map((a: unknown) => unmaskText(String(a ?? ""), rmap))
                      : [],
                    ai_note: typeof it.ai_note === "string" ? unmaskText(it.ai_note, rmap) : "",
                  };
                }
                if (parsed.summary) {
                  // summary é agregado do chunk; junta reverseMaps de todos os
                  // itens do chunk para cobrir qualquer PACIENTE_N mencionado.
                  const chunkMap: ReverseMap = {};
                  for (const it of parsed.items ?? []) {
                    Object.assign(chunkMap, reverseMapByItemId[it.id] ?? {});
                  }
                  summaries.push(unmaskText(String(parsed.summary), chunkMap));
                }
              }
              return true;
            }

            // 402 = créditos indisponíveis. Não deve prender o lote em falha
            // parcial: usamos justificativa determinística e seguimos.
            if (aiResp.status === 402) {
              const txt = await aiResp.text().catch(() => "");
              console.warn(`${__t} AI indisponível por crédito chunk ${ci + 1}/${aiChunks.length}: ${txt.slice(0, 200)}`);
              applyAiUnavailableFallback(chunk, "créditos de IA indisponíveis");
              return true;
            }

            // 429/529 (rate-limited/overloaded) são transitórios: vale retry.
            // Se ainda assim falhar, cai para justificativa determinística para
            // não deixar a empresa eternamente na lista de falhas da IA.
            if (aiResp.status === 429 || aiResp.status === 529) {
              const txt = await aiResp.text().catch(() => "");
              console.warn(`${__t} AI ${aiResp.status} chunk ${ci + 1}/${aiChunks.length} attempt ${attempt + 1}: ${txt.slice(0, 200)}`);
              if (attempt < AI_MAX_RETRIES) {
                __telemetry.ai_chunks_retried++;
                await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                continue;
              }
              applyAiUnavailableFallback(chunk, aiResp.status === 429 ? "limite temporário da IA" : "provedor de IA sobrecarregado");
              return true;
            }

            // Outros erros HTTP: não vale retry; loga, aplica fallback e desiste.
            const txt = await aiResp.text().catch(() => "");
            console.error(`${__t} AI justification error chunk ${ci + 1}/${aiChunks.length}`, aiResp.status, txt);
            applyAiUnavailableFallback(chunk, `erro ${aiResp.status} da IA`);
            return false;
          } catch (aiErr: any) {
            // Abort/timeout/rede: retry se ainda houver tentativa.
            const msg = aiErr?.message ?? String(aiErr);
            const isTransient = msg.includes("abort") || msg.includes("network") || aiErr?.name === "AbortError" || aiErr?.name === "TypeError";
            console.warn(`${__t} chamada_ia chunk ${ci + 1}/${aiChunks.length} attempt ${attempt + 1} falhou: ${msg}`);
            if (isTransient && attempt < AI_MAX_RETRIES) {
              __telemetry.ai_chunks_retried++;
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
              continue;
            }
            applyAiUnavailableFallback(chunk, isTransient ? "timeout/erro de rede na IA" : "erro inesperado na IA");
            return false;
          } finally {
            clearTimeout(aiTimer);
          }
        }
        return false;
      };

      // Pool de concorrência simples: até AI_CHUNK_CONCURRENCY chunks em voo.
      const indexed = aiChunks.map((c, i) => ({ chunk: c, idx: i }));
      const failedChunks: number[] = [];
      for (let i = 0; i < indexed.length; i += AI_CHUNK_CONCURRENCY) {
        const slice = indexed.slice(i, i + AI_CHUNK_CONCURRENCY);
        const results = await Promise.all(slice.map(({ chunk, idx }) => runChunk(chunk, idx)));
        results.forEach((ok, k) => { if (!ok) failedChunks.push(slice[k].idx); });
      }
      __telemetry.ai_chunks_failed = failedChunks.length;

      // VISIBILIDADE: prefixa o resumo com aviso de falha parcial para que o
      // analista NÃO interprete ausência de justificativas como "tudo certo".
      let summaryText = summaries.join(" ");
      if (failedChunks.length > 0) {
        const warn = `⚠️ ${failedChunks.length} de ${aiChunks.length} chunks da IA falharam após retry — justificativas podem estar incompletas.`;
        summaryText = `${warn} ${summaryText}`.trim();
        console.error(`${__t} ai_partial_failure: ${failedChunks.length}/${aiChunks.length} chunks falharam (chunks ${failedChunks.join(",")})`);
      }
      (aiJustifications as any).__summary = summaryText;
    }



    console.timeEnd(`${__t} chamada_ia`);
    __telemetry.ai_ms = Date.now() - __aiStart;

    // ---------- 6. Caller (para snapshots) ----------
    let triggeredBy: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const jwt = authHeader.replace("Bearer ", "");
        const { data: u } = await supabase.auth.getUser(jwt);
        triggeredBy = u?.user?.id ?? null;
      }
    } catch (_) { /* opcional */ }

    // ---------- 7. Snapshots prévios para diff ----------
    const itemIds = results.map((r) => r.item_id);
    const { data: prevVersions } = await supabase
      .from("ai_analysis_versions")
      .select("item_id, version, ai_status, expected_amount, alerts, matched_rules")
      .in("item_id", itemIds);
    const prevByItem: Record<string, { version: number; ai_status: string; expected_amount: number | null; alerts: string[]; matched_rules: string[] }> = {};
    for (const v of prevVersions ?? []) {
      const cur = prevByItem[v.item_id as string];
      if (!cur || (v.version as number) > cur.version) {
        prevByItem[v.item_id as string] = {
          version: v.version as number,
          ai_status: v.ai_status as string,
          expected_amount: (v.expected_amount as number | null) ?? null,
          alerts: (v.alerts as string[]) ?? [],
          matched_rules: (v.matched_rules as string[]) ?? [],
        };
      }
    }

    // ---------- 8. Persiste resultados (em lote / paralelizado) ----------
    if (is_dry_run) {
      console.log(`[DRY RUN] Analysis completed for ${results.length} items. Skipping persistence.`);
      return new Response(
        JSON.stringify({ 
          ok: true, 
          is_dry_run: true,
          total: results.length,
          results: results.map(r => ({
            item_id: r.item_id,
            status: r.status,
            expected_amount: r.expected_amount,
            matched_rule_name: r.matched_rule_name,
            calculation_explanation: r.calculation_explanation,
            breakdown: r.calculation_breakdown
          }))
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Antes: cada item fazia UPDATE + INSERT + (talvez) INSERT em sequência
    // dentro de um for..await, o que estourava o timeout de 150s da edge
    // function quando o lote tinha muitos itens. Agora preparamos as linhas
    // sincronamente e disparamos as escritas em paralelo (updates em chunks,
    // inserts em bulk).
    let alerts = 0, blocks = 0;
    const itemDiffSummaries: { item_id: string; doctor: string; diff: string }[] = [];
    const itemsById: Record<string, ItemInput> = {};
    for (const it of items) itemsById[it.id] = it;
    const itemsRawById: Record<string, any> = {};
    for (const it of (itemsRaw ?? []) as any[]) itemsRawById[it.id] = it;

    // ===== Sub-Onda 2B — Detecção de duplicidade entre lotes =====
    // Busca itens com o MESMO item_hash em OUTROS pagamentos e classifica
    // por status do lote-fonte (block / warn / none). Override prévio
    // (ai_findings.duplicate_detection.override) é respeitado.
    type DupMatch = {
      other_item_id: string;
      other_payment_id: string;
      other_payment_reference: string;
      other_payment_status: string;
      other_attendance_number: string | null;
      other_patient_name: string | null;
      other_procedure_date: string | null;
      other_doctor_name: string | null;
      other_doctor_role: string | null;
      other_expected_amount: number | null;
      severity: "block" | "warn";
    };
    const dupByItemId: Record<string, {
      severity: "block" | "warn" | "override";
      matches: DupMatch[];
      uncovered: DupMatch[];
      override: DuplicateOverridePayload | null;
    }> = {};

    const hashesPresent = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => it.item_hash).filter(Boolean) as string[],
    ));
    if (hashesPresent.length > 0) {
      // Carrega regras de duplicidade ativas do hospital para respeitar
      // doctor_mode/compare_patient/window_days configurados pelo usuário.
      // Sem essa filtragem, o item_hash (att+agr+date+code+role) sozinho
      // pode marcar como duplicidade pares que a regra do hospital ignora
      // (ex.: médicos diferentes quando doctor_mode = "same").
      let __dupRulesForHospital: Array<{
        doctor_mode: "same" | "any" | "different";
        window_days: number;
        compare_patient: boolean;
      }> = [];
      try {
        let __vrQ = supabase
          .from("validation_rules")
          .select("kind,active,hospital_id,params")
          .eq("active", true)
          .in("kind", ["duplicidade_lancamento", "duplicidade_exata", "duplicidade_atendimento"]);
        if (__paymentHospitalId) __vrQ = __vrQ.eq("hospital_id", __paymentHospitalId);
        const { data: __vrRows } = await __vrQ;
        for (const r of (__vrRows ?? []) as any[]) {
          const p = (r?.params ?? {}) as any;
          const dm = (p.doctor_mode as string) ??
            (p.compare_doctor === false || p.allow_different_doctors === true ? "any" : "same");
          __dupRulesForHospital.push({
            doctor_mode: (dm === "any" || dm === "different" ? dm : "same") as
              "same" | "any" | "different",
            window_days: typeof p.window_days === "number" && p.window_days > 0 ? p.window_days : 0,
            compare_patient: p.compare_patient !== false,
          });
        }
      } catch (_e) { /* fail-open: sem regras carregadas, mantém comportamento anterior */ }

      // Se não há regra de duplicidade configurada, NÃO devemos marcar cross-lote
      // (o motor não pode aplicar regra que o hospital não cadastrou).
      const __hasDupRules = __dupRulesForHospital.length > 0;

      const { data: dupRows } = await supabase
        .from("payment_items")
        .select(`
          id,payment_id,item_hash,attendance_number,patient_name,procedure_date,
          doctor_name,doctor_role,expected_amount,
          payment:payments!inner(id,reference,status)
        `)
        .in("item_hash", hashesPresent)
        .neq("payment_id", payment_id);

      const byHash: Record<string, any[]> = {};
      for (const row of (dupRows ?? []) as any[]) {
        (byHash[row.item_hash as string] ||= []).push(row);
      }

      // Verifica se o par (item local × item de outro lote) seria flagado
      // por ao menos UMA regra de duplicidade cadastrada. Como o item_hash
      // já garante mesmo (att+conv+data+tuss+função), aqui só validamos os
      // eixos remanescentes: doctor_mode e compare_patient.
      const __pairAllowedByAnyRule = (
        itDoc: string | null | undefined,
        itPat: string | null | undefined,
        otherDoc: string | null | undefined,
        otherPat: string | null | undefined,
      ): boolean => {
        if (!__hasDupRules) return false;
        const dA = normName(itDoc ?? "");
        const dB = normName(otherDoc ?? "");
        const pA = normName(itPat ?? "");
        const pB = normName(otherPat ?? "");
        for (const rule of __dupRulesForHospital) {
          if (rule.doctor_mode === "same" && dA && dB && dA !== dB) continue;
          if (rule.doctor_mode === "different" && dA && dB && dA === dB) continue;
          if (rule.compare_patient && pA && pB && pA !== pB) continue;
          return true;
        }
        return false;
      };

      for (const it of (itemsRaw ?? []) as any[]) {
        const hash = it.item_hash as string | null;
        if (!hash) continue;
        const candidates = byHash[hash] ?? [];
        if (candidates.length === 0) continue;

        const matches: DupMatch[] = [];
        for (const c of candidates) {
          const st = String(c.payment?.status ?? "");
          const sev = classifyDuplicateMatch(st);
          if (sev === "none") continue;
          // Respeita configuração do hospital (doctor_mode/compare_patient).
          // Sem regra cadastrada OU par não flagado por nenhuma regra → ignora.
          if (!__pairAllowedByAnyRule(
            it.doctor_name, it.patient_name, c.doctor_name, c.patient_name,
          )) continue;
          matches.push({
            other_item_id: c.id,
            other_payment_id: c.payment_id,
            other_payment_reference: String(c.payment?.reference ?? ""),
            other_payment_status: st,
            other_attendance_number: c.attendance_number ?? null,
            other_patient_name: c.patient_name ?? null,
            other_procedure_date: c.procedure_date ?? null,
            other_doctor_name: c.doctor_name ?? null,
            other_doctor_role: c.doctor_role ?? null,
            other_expected_amount: c.expected_amount != null ? Number(c.expected_amount) : null,
            severity: sev,
          });
        }
        if (matches.length === 0) continue;

        const existingOverride =
          (it.ai_findings?.duplicate_detection?.override ?? null) as DuplicateOverridePayload | null;
        // BUGFIX 2B — escopo restrito: cada colisão precisa estar individualmente
        // coberta pelo paired_with_*; matches novos NÃO são liberados pelo override antigo.
        const evaluated = evaluateDuplicate(matches, existingOverride);
        const finalSev: "block" | "warn" | "override" =
          evaluated.severity === "none" ? "warn" : evaluated.severity;
        dupByItemId[it.id] = {
          severity: finalSev,
          matches,
          uncovered: evaluated.uncovered,
          override: existingOverride,
        };
      }
    }
    // ===== fim 2B =====


    // ===== Post-pass CONTÁGIO DE EXCLUSÃO =====
    // Quando uma linha de cálculo de exclusão está marcada com
    // `contagia_atendimento`, ao disparar exclusão para 1 item, todos os
    // demais itens do mesmo (attendance_number, procedure_date::date) são
    // zerados. Exceção: se pelo menos 1 item do atendimento pertencer a
    // médico listado na regra (target_doctor_id em regra específica de médico,
    // ou group_doctors em regra de grupo), o atendimento inteiro é poupado.
    try {
      const __contagiaByCalcId: Record<string, boolean> = {};
      const __rulesById: Record<string, any> = {};
      for (const rule of rules as any[]) {
        if (rule?.id) __rulesById[rule.id] = rule;
        const cs = Array.isArray(rule?.calculations) ? rule.calculations : [];
        for (const c of cs) {
          if (c?.id && c.contagia_atendimento === true) __contagiaByCalcId[c.id] = true;
        }
      }

      const __attKeyFor = (it: any): string | null => {
        const att = (it?.attendance_number ?? "").toString().trim();
        const d = it?.procedure_date ? String(it.procedure_date).slice(0, 10) : "";
        if (!att || !d) return null;
        return `${att}||${d}`;
      };

      type __Contagion = { ruleId: string; sourceTuss: string };
      const __contagionByKey = new Map<string, __Contagion>();

      for (const r of results) {
        if (r.calculation_type_used !== "exclusao") continue;
        if (!r.matched_rule_id) continue;
        const bd = Array.isArray((r as any).calculation_breakdown) ? (r as any).calculation_breakdown : [];
        const matched = bd.find((b: any) => b?.matched && b.calc_id);
        const calcId = matched?.calc_id ?? null;
        if (!calcId || !__contagiaByCalcId[calcId]) continue;
        const it = itemsById[r.item_id];
        const key = __attKeyFor(it);
        if (!key) continue;
        if (!__contagionByKey.has(key)) {
          __contagionByKey.set(key, {
            ruleId: r.matched_rule_id,
            sourceTuss: (it?.procedure_code ?? "").toString(),
          });
        }
      }

      if (__contagionByKey.size > 0) {
        const __itemsByKey = new Map<string, any[]>();
        for (const it of items) {
          const k = __attKeyFor(it);
          if (!k || !__contagionByKey.has(k)) continue;
          const arr = __itemsByKey.get(k);
          if (arr) arr.push(it); else __itemsByKey.set(k, [it]);
        }

        const __normDoc = (s: any) => String(s ?? "").replace(/\D/g, "");
        const __normNm = (s: any) => String(s ?? "")
          .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        const __doctorInTeam = (it: any, rule: any): boolean => {
          if (!rule) return false;
          if (rule.target_type === "medico" && rule.target_doctor_id && it?.doctor_id
              && String(rule.target_doctor_id) === String(it.doctor_id)) return true;
          const list: any[] = Array.isArray(rule.group_doctors) ? rule.group_doctors : [];
          if (list.length === 0) return false;
          const itDoc = __normDoc(it?.doctor_document);
          const itNm = __normNm(it?.doctor_name);
          const itId = it?.doctor_id ? String(it.doctor_id) : null;
          for (const d of list) {
            if (!d) continue;
            if ((d as any).id && itId && String((d as any).id) === itId) return true;
            const dDoc = __normDoc((d as any).document ?? (d as any).crm);
            if (dDoc && itDoc && dDoc === itDoc) return true;
            const dNm = __normNm((d as any).name ?? (d as any).full_name);
            if (dNm && itNm && dNm === itNm) return true;
          }
          return false;
        };

        for (const [key, cg] of __contagionByKey.entries()) {
          const bucket = __itemsByKey.get(key) ?? [];
          const rule = __rulesById[cg.ruleId];
          const hasTeam = bucket.some((it) => __doctorInTeam(it, rule));
          if (hasTeam) continue;

          for (const it of bucket) {
            const r = resultById[it.id];
            if (!r) continue;
            // O próprio item que disparou a exclusão fica com método "exclusao"
            // (fonte original); apenas os DEMAIS itens do atendimento são
            // marcados como "exclusao_contagio" para distinguir na auditoria.
            const isSource = r.calculation_type_used === "exclusao"
              && r.matched_rule_id === cg.ruleId;
            if (isSource) continue;
            r.expected_amount = 0;
            r.calculation_type_used = "exclusao_contagio" as any;
            r.matched_rule_id = cg.ruleId;
            r.matched_rule_name = rule?.name
              ? `${rule.name} (contágio)`
              : "Exclusão por contágio";
            r.matched_priority = "conflito" as any;
            r.calculation_explanation =
              `Excluído por contágio: TUSS ${cg.sourceTuss || "—"} no mesmo atendimento`
              + ` disparou exclusão que contamina todos os itens do atendimento+data.`;
            r.status = "reprovado" as any;
            r.alerts = [
              `Item excluído por contágio da regra "${rule?.name ?? "—"}"`
              + ` (TUSS origem ${cg.sourceTuss || "—"} no mesmo atendimento).`,
              ...((r.alerts ?? []) as string[]),
            ];
            r.needs_ai_review = false;
            (r as any).contagio_atendimento = true;
            (r as any).contagio_source_tuss = cg.sourceTuss || null;
          }
        }
      }
    } catch (e) {
      console.error("[contagio_exclusao] falha:", e);
    }
    // ===== fim contágio =====




    type ItemUpdate = {
      id: string;
      ai_status: string;
      ai_findings: any;
      attendance_group_key: string | null;
      specialty: string | null;
      sector: string | null;
      // Sub-Onda 2A — colunas SQL nativas espelhando o motor de regras.
      applied_rule_id: string | null;
      applied_rule_label: string | null;
      applied_calc_id: string | null;
      applied_calc_method: AppliedCalcMethod | null;
      expected_amount: number | null;
      applied_at: string | null;
      // Pacote: marcação de absorção persistida no DB. Garante que
      // compute-company-financials EXCLUA o gross do secundário do bruto.
      package_absorbed?: boolean;
      package_absorbed_calc_id?: string | null;
      /** Ambiguidade de pacote (multi_anchor / no_anchor) + decisão do analista. */
      package_ambiguity?: Record<string, unknown> | null;
      convenio_basis_detected?: string | null;
      basis_confidence?: number | null;
      piso_aplicado_valor?: number | null;
      piso_metodo_vencedor?: string | null;
      // Cache determinístico da IA — hash + timestamp de geração.
      ai_input_hash?: string | null;
      ai_cached_at?: string | null;
    };
    type VersionRow = Record<string, unknown>;
    type ObsRow = Record<string, unknown>;

    const itemUpdates: ItemUpdate[] = [];
    const versionRows: VersionRow[] = [];
    const obsRows: ObsRow[] = [];

    // Sub-Onda 2A — Caminho 2: carimbo consistente de applied_calc_method.
    // Constrói mapas de lookup para resolver calculation_type quando o motor
    // não o reportou em r.calculation_type_used (caso conhecido em valor_fixo,
    // pacote* e percentual_sobre_convenio). Ordem: rule_calculations.id (via
    // applied_calc_id) → rules.calculation_type (via matched_rule_id).
    const calcTypeByCalcId: Record<string, string | null> = {};
    const calcTypeByRuleId: Record<string, string | null> = {};
    for (const rule of rules as any[]) {
      if (rule?.id) calcTypeByRuleId[rule.id] = rule.calculation_type ?? null;
      const calcs = Array.isArray(rule?.calculations) ? rule.calculations : [];
      for (const c of calcs) {
        if (c?.id) calcTypeByCalcId[c.id] = c.calculation_type ?? null;
      }
    }

    for (const r of results) {

      const it = itemsById[r.item_id];
      const aiJ = aiJustifications[r.item_id];
      const finalAlerts = [...r.alerts, ...(aiJ?.extra_alerts ?? [])];
      const matchedRules = r.matched_rule_name ? [r.matched_rule_name] : [];
      const matchedRuleIds = r.matched_rule_id ? [r.matched_rule_id] : [];

      const itRaw = itemsRawById[r.item_id];
      const resolvedSpec = itRaw?.__resolved_specialty as { value: string | null; source: string } | undefined;
      const decisionFields = {
        used: {
          // `sector` agora reflete o setor REAL persistido em payment_items
          // (vindo da planilha). `classification_sector` é a heurística
          // determinística (ex.: tabela de hemodinâmica) e `inferred_sector`
          // é o que o motor calculou quando o item não tinha setor —
          // separamos para que o trace deixe claro qual valor foi usado.
          sector: it?.sector ?? null,
          classification_sector: it?.classification_sector ?? null,
          inferred_sector: (r as any).inferred_sector ?? r.selection_trace?.item_sector ?? null,
          procedure_code: it?.procedure_code ?? null,
          doctor_document: it?.doctor_document ?? null,
          doctor_name: it?.doctor_name ?? null,
          company_id: it?.company_id ?? null,
          company_document: it?.company_document ?? null,
          agreement_name: it?.agreement_name ?? null,
          access_route: it?.access_route ?? null,
          doctor_role: it?.doctor_role ?? null,
          procedure_date: it?.procedure_date ?? null,
        },
        ignored: {
          specialty: {
            used: false,
            value: resolvedSpec?.value ?? it?.specialty ?? null,
            reason: "Especialidade é metadado de relatório/filtro e nunca entra na seleção de regra (regra de projeto).",
          },
          patient_name: { used: false, reason: "Apenas informacional." },
          procedure_name: { used: false, reason: "Apenas informacional; matching é por procedure_code." },
        },
      };

      const findings = {
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        medical_specialty_resolved: resolvedSpec
          ? { value: resolvedSpec.value, source: resolvedSpec.source }
          : null,
        engine: {
          calculation_type_used: r.calculation_type_used,
          matched_priority: r.matched_priority,
          diff_pct: r.diff_pct,
          ai_note: aiJ?.ai_note ?? null,
          ai_fallback: aiJ?.ai_fallback === true ? true : false,
          contagio_atendimento: (r as any).contagio_atendimento === true ? true : false,
          contagio_source_tuss: (r as any).contagio_source_tuss ?? null,
        },
        calculation_breakdown: r.calculation_breakdown ?? null,
        selection_trace: r.selection_trace ?? null,
        decision_fields: decisionFields,
      } as any;

      // Sub-Onda 2B — aplica duplicate_detection com escopo restrito do override.
      // BUGFIX: matches não cobertos pelo paired_with_* derrubam o override
      // e voltam a bloquear/alertar. matched_items mostra TODAS as colisões
      // (cobertas e não-cobertas) para visibilidade; uncovered_matches lista
      // exatamente as que ainda exigem decisão.
      const dup = dupByItemId[r.item_id];
      let finalStatus = r.status;
      if (dup) {
        if (dup.severity === "override") {
          findings.duplicate_detection = {
            status: "override_applied",
            matched_items: dup.matches,
            uncovered_matches: [],
            override: dup.override,
          };
        } else if (dup.severity === "block") {
          const head = dup.uncovered[0];
          findings.duplicate_detection = {
            status: "blocked",
            matched_items: dup.matches,
            uncovered_matches: dup.uncovered,
            override: dup.override, // mantém override prévio para auditoria
          };
          // Em confecção o sistema CALCULOU o repasse — não pode bloquear por
          // duplicidade de outro lote, apenas registra para auditoria.
          if (!isConfeccao) {
            finalStatus = "erro_duplicidade_pagamento";
            findings.alerts = [
              ...findings.alerts,
              `Duplicidade de pagamento bloqueada: item já registrado em lote ${head.other_payment_reference} (status ${head.other_payment_status})${dup.override ? " — override prévio não cobre esta colisão" : ""}.`,
            ];
          }
        } else {
          const head = dup.uncovered[0];
          // Rebaixa para "info" quando TODOS os matches não-cobertos são de
          // médicos diferentes: mesmo paciente/atendimento/data/TUSS/função,
          // mas outro profissional atendeu — é sobreposição possível, não
          // duplicidade real. Mantém o registro em duplicate_detection para
          // auditoria, mas não empurra alerta nem muda status.
          const normDoc = (s: string | null | undefined) =>
            (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .toLowerCase().replace(/[^a-z0-9]+/g, "");
          const selfDoctor = normDoc(it?.doctor_name);
          const allDifferentDoctor = selfDoctor.length > 0 && dup.uncovered.every(
            (m) => {
              const other = normDoc(m.other_doctor_name);
              return other.length > 0 && other !== selfDoctor;
            },
          );
          findings.duplicate_detection = {
            status: allDifferentDoctor ? "info_different_doctor" : "warned",
            matched_items: dup.matches,
            uncovered_matches: dup.uncovered,
            override: dup.override,
          };
          if (!isConfeccao && !allDifferentDoctor) {
            findings.alerts = [
              ...findings.alerts,
              `Possível duplicidade: item também consta no lote ${head.other_payment_reference} (status ${head.other_payment_status}).`,
            ];
            if (finalStatus === "aprovado") finalStatus = "alerta";
          }
        }
      }

      // ===== Sub-Onda 2C — duplicidade entre cálculos da mesma regra =====
      const priorCalcDup = itRaw?.ai_findings?.calc_duplicity ?? null;
      const priorResolution = priorCalcDup?.resolution ?? null;
      const isCalcDuplicityBlock = !!(r.calc_duplicity && r.expected_amount === null);
      const isResolutionStaleSingle = !!(r.calc_duplicity?.resolution_stale && r.expected_amount !== null);

      if (isCalcDuplicityBlock && !isConfeccao) {
        finalStatus = "erro_duplicidade_calculo" as any;
        findings.calc_duplicity = {
          rule_id: r.calc_duplicity!.rule_id,
          rule_name: r.calc_duplicity!.rule_name,
          matched_calculations: r.calc_duplicity!.matched_calculations,
          ...(priorResolution ? { resolution: priorResolution } : {}),
          ...(r.calc_duplicity!.resolution_stale ? { resolution_stale: true } : {}),
        };
        findings.alerts = [
          ...findings.alerts,
          `Cadastro com ambiguidade: a regra "${r.calc_duplicity!.rule_name}" possui ${r.calc_duplicity!.matched_calculations.length} cálculos válidos para este item. Defina manualmente qual aplicar.`,
        ];
      } else if (isResolutionStaleSingle) {
        // Resolveu para um único cálculo válido, mas a escolha anterior do analista
        // referenciava um calc removido — preserva resolution para auditoria mas marca stale.
        findings.calc_duplicity = {
          rule_id: r.calc_duplicity!.rule_id,
          rule_name: r.calc_duplicity!.rule_name,
          matched_calculations: r.calc_duplicity!.matched_calculations,
          resolution_stale: true,
          ...(priorResolution ? { resolution: priorResolution } : {}),
        };
      } else if (priorResolution) {
        // Aplicou normalmente um cálculo cuja escolha continua válida — preserva resolution.
        findings.calc_duplicity = {
          ...(priorCalcDup ?? {}),
          resolution: priorResolution,
        };
      }
      // ===== fim 2C =====

      // CONFECÇÃO: defesa em profundidade. O sistema CALCULOU o repasse pelas
      // regras — não pode aparecer reprovado/alerta por causa de overrides
      // posteriores (duplicidade, calc_duplicity, etc.). Tudo sai aprovado.
      if (isConfeccao) {
        finalStatus = "aprovado" as any;
        findings.alerts = [];
      }

      const appliedCalcId = isCalcDuplicityBlock
        ? null
        : ((r.calculation_breakdown ?? []).find((b) => b.matched && b.calc_id)?.calc_id ?? null);
      // Resolve calculation_type com fallback determinístico (Caminho 2):
      // 1) o que o motor reportou; 2) rule_calculations via applied_calc_id;
      // 3) rules.calculation_type via matched_rule_id. Garante carimbo
      // consistente em valor_fixo / pacote* / percentual_sobre_convenio.
      let resolvedCalcType: string | null = (r as any).calculation_type_used ?? null;
      if (!resolvedCalcType && !isCalcDuplicityBlock) {
        if (appliedCalcId && calcTypeByCalcId[appliedCalcId]) {
          resolvedCalcType = calcTypeByCalcId[appliedCalcId];
        } else if (r.matched_rule_id && calcTypeByRuleId[r.matched_rule_id]) {
          resolvedCalcType = calcTypeByRuleId[r.matched_rule_id];
        }
      }
      const appliedCalcMethod = isCalcDuplicityBlock
        ? null
        : mapCalculationTypeToMethod(resolvedCalcType);


      // SECTOR: nunca sobrescrever `payment_items.sector` quando o item já
      // tem setor vindo da planilha. O setor da base importada é a fonte da
      // verdade — o motor apenas INFERE para itens sem setor (legados).
      // Auditoria do que o motor inferiu fica em ai_findings.engine.inferred_sector.
      const originalItem = itemsById[r.item_id];
      const rawItem = itemsRawById[r.item_id];
      const persistedSector = originalItem?.sector ?? null;
      const rawSector = rawSectorFromRawData(rawItem?.raw_data);
      // HIERARQUIA: planilha vence. Persistido só quando raw ausente.
      const originalSector = rawSector && String(rawSector).trim() !== ""
        ? rawSector
        : (persistedSector && !["outro", "outros"].includes(normName(persistedSector))
            ? persistedSector
            : null);
      const inferredSector = (r as any).inferred_sector ?? r.selection_trace?.item_sector ?? null;
      const sectorToPersist = originalSector && String(originalSector).trim() !== ""
        ? inferItemSector({ ...(originalItem as ItemInput), sector: originalSector }, ctx)
        : inferredSector;

      // PRESERVAR ACATE: se o item já foi acatado pelo analista/diretor, a
      // reanálise NÃO pode sobrescrever ai_status, expected_amount, gross_amount
      // nem ai_findings — caso contrário o acate "some" e o item volta ao
      // valor sugerido antigo. Ainda gravamos uma versão para auditoria.
      const alreadyAcatado = (rawItem?.ai_status === "acatado");
      if (alreadyAcatado) {
        const prev = prevByItem[r.item_id];
        const nextVersion = (prev?.version ?? 0) + 1;
        versionRows.push({
          payment_id,
          hospital_id: __paymentHospitalId,
          item_id: r.item_id,
          version: nextVersion,
          ai_status: "acatado",
          alerts: [],
          matched_rules: [],
          matched_rule_ids: [],
          expected_amount: null,
          calculation_explanation: "Reanálise preservou acate manual (ai_status=acatado).",
          gross_amount_at_time: originalItem ? originalItem.gross_amount : null,
          model: "engine",
          triggered_by: triggeredBy,
        });
        continue;
      }


      itemUpdates.push({
        id: r.item_id,
        ai_status: finalStatus,
        ai_findings: {
          ...findings,
          engine: {
            ...(findings.engine || {}),
            inferred_sector: inferredSector,
            original_sector: originalSector,
          }
        },
        attendance_group_key: r.attendance_group_key ?? null,
        specialty: resolvedSpec?.value ?? null,
        sector: sectorToPersist,
        applied_rule_id: r.matched_rule_id ?? null,
        applied_rule_label: r.matched_rule_name ?? null,

        applied_calc_id: appliedCalcId,
        applied_calc_method: appliedCalcMethod,
        expected_amount: isCalcDuplicityBlock ? null : (r.expected_amount ?? null),
        applied_at: isCalcDuplicityBlock ? null : new Date().toISOString(),
        convenio_basis_detected: r.convenio_basis_detected ?? null,
        basis_confidence: r.basis_confidence ?? null,
        // Preserva absorção manual feita pelo analista: se o item raw já vinha
        // com package_absorbed=true e o motor não absorveu/desabsorveu
        // explicitamente neste run, mantém o flag (e o calc_id) do banco.
        // Exceção: absorções órfãs (staleAbsorbedItemIds) — o pacote-âncora
        // sumiu do atendimento (base reimportada, calc removido) e o item
        // ficou parado com expected=0. Nesses casos, limpa o flag para o
        // motor recalcular normalmente.
        package_absorbed: (r as any).package_absorbed === true
          || (rawItem?.package_absorbed === true && !staleAbsorbedItemIds.has(r.item_id)),
        package_absorbed_calc_id: (r as any).package_absorbed_calc_id
          ?? (rawItem?.package_absorbed === true && !staleAbsorbedItemIds.has(r.item_id)
            ? (rawItem?.package_absorbed_calc_id ?? null)
            : null),
        // Ambiguidade de pacote. Decisão do analista (resolved) é soberana:
        // reanálise nunca sobrescreve item já resolvido.
        package_ambiguity: rawItem?.package_ambiguity?.resolved
          ? rawItem.package_ambiguity
          : (packageAmbiguityByItemId.get(r.item_id) ?? null),
        // Piso por procedimento (mínimo garantido). null quando piso não configurado.
        piso_aplicado_valor: (r as any).piso_aplicado_valor ?? null,
        piso_metodo_vencedor: (r as any).piso_metodo_vencedor ?? null,
        // Trilha de auditoria inline do piso — usada para contestações futuras
        // e para a view v_piso_recorrencia (convênios defasados).
        piso_context: ((r as any).piso_aplicado_valor != null && (r as any).piso_metodo_vencedor != null)
          ? {
              piso_valor: Number((r as any).piso_aplicado_valor),
              metodo_vencedor: (r as any).piso_metodo_vencedor,
              escopo: (r as any).piso_escopo ?? "por_item",
              applied_at: new Date().toISOString(),
              rule_id: (r as any).applied_rule_id ?? null,
              calc_id: (r as any).applied_calc_id ?? null,
            }
          : null,
        // Persistência do cache determinístico da IA. Vale tanto para cache hit
        // (reuso do hash prévio) quanto para cache miss (novo hash calculado).
        ai_input_hash: hashByItemId[r.item_id] ?? null,
        ai_cached_at: hashByItemId[r.item_id] ? new Date().toISOString() : null,
      });


      if (finalStatus === "alerta") alerts++;
      if (
        finalStatus === "reprovado" ||
        finalStatus === "erro_duplicidade_pagamento" ||
        finalStatus === "erro_duplicidade_calculo"
      ) blocks++;

      const prev = prevByItem[r.item_id];
      const nextVersion = (prev?.version ?? 0) + 1;
      versionRows.push({
        payment_id,
        hospital_id: __paymentHospitalId,
        item_id: r.item_id,
        version: nextVersion,
        ai_status: r.status,
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        gross_amount_at_time: it ? it.gross_amount : null,
        model: aiJ ? "engine+claude-sonnet-4-5" : "engine",
        triggered_by: triggeredBy,
      });

      if (prev) {
        const diffParts: string[] = [];
        if (prev.ai_status !== r.status) diffParts.push(`status: ${prev.ai_status} → ${r.status}`);
        if ((prev.expected_amount ?? null) !== (r.expected_amount ?? null)) {
          diffParts.push(`valor esperado: ${prev.expected_amount ?? "—"} → ${r.expected_amount ?? "—"}`);
        }
        const prevA = new Set(prev.alerts ?? []);
        const newA = new Set(finalAlerts);
        const added = [...newA].filter((a) => !prevA.has(a));
        const removed = [...prevA].filter((a) => !newA.has(a));
        if (added.length) diffParts.push(`+ ${added.length} alerta(s): ${added.slice(0, 2).join("; ")}${added.length > 2 ? "…" : ""}`);
        if (removed.length) diffParts.push(`- ${removed.length} alerta(s) resolvido(s)`);
        const prevR = new Set(prev.matched_rules ?? []);
        const newR = new Set(matchedRules);
        const addedR = [...newR].filter((x) => !prevR.has(x));
        if (addedR.length) diffParts.push(`nova regra: ${addedR.join("; ")}`);
        if (diffParts.length) {
          itemDiffSummaries.push({ item_id: r.item_id, doctor: it?.doctor_name ?? "item", diff: diffParts.join(" · ") });
          obsRows.push({
            payment_id,
            hospital_id: __paymentHospitalId,
            item_id: r.item_id,
            author_type: "ia",
            message: `Reanálise v${nextVersion}: ${diffParts.join(" · ")}`,
          });
        }
      } else {
        const parts: string[] = [`Análise inicial v1 — ${r.status} (${r.matched_priority})`];
        if (r.expected_amount != null) parts.push(`esperado R$ ${r.expected_amount.toFixed(2)}`);
        if (finalAlerts.length) parts.push(`${finalAlerts.length} alerta(s)`);
        obsRows.push({
          payment_id,
          hospital_id: __paymentHospitalId,
          item_id: r.item_id,
          author_type: "ia",
          message: parts.join(" · ") + ` — ${r.calculation_explanation}` + (aiJ?.ai_fallback ? ` | IA indisponível — decisão do motor` : (aiJ?.ai_note ? ` | IA: ${aiJ.ai_note}` : "")),
        });
      }
    }

    // ===== Síntese de linhas de bônus (Fase B) =====
    // Regras de bônus NÃO competem no matching por-item (fase A no motor).
    // Aqui percorremos as regras de bônus ativas e emitimos 1 linha
    // (tipo_linha='complemento_bonus', tipo_item='bonus', synthetic_bonus=true)
    // por (regra × atendimento) ancorada no cirurgião principal. O cálculo é
    // independente do TUSS pai: base é procedure_amount conforme application_unit
    // (por_item = âncora; por_atendimento/por_paciente_dia = soma do grupo).
    const bonusLinesToInsert: Record<string, unknown>[] = [];
    const bonusCompanyNames = new Set<string>();
    const bonusTotalByCompany: Record<string, number> = {};
    const preSplitExpectedByCompany: Record<string, number> = {};

    // 1) Descobre regras de bônus (rule-level OR calc-level).
    const activeBonusRules = (rules ?? []).filter((r: any) => {
      if ((r?.calculation_type ?? "") === "bonus") return true;
      const cs = Array.isArray(r?.calculations) ? r.calculations : [];
      return cs.some((c: any) => (c?.calculation_type ?? "") === "bonus");
    });

    if (activeBonusRules.length > 0) {
      // 2) Agrupa itens por attendance_group_key (fallback attendance_number).
      const groups = new Map<string, { anchor: ItemInput; groupItems: ItemInput[] }>();
      // Mapa item_id -> AnalysisResult (para descobrir main / group key)
      const resultByItemId = new Map<string, AnalysisResult>();
      for (const r of results) resultByItemId.set(r.item_id, r);

      const groupKeyFor = (it: ItemInput): string | null => {
        const r = resultByItemId.get((it as any).id);
        const gk = (r?.attendance_group_key as string | undefined) ?? (it.attendance_number ?? null);
        return gk && String(gk).trim() ? String(gk).trim() : null;
      };

      // Bucket
      const buckets = new Map<string, ItemInput[]>();
      for (const it of items) {
        const gk = groupKeyFor(it);
        if (!gk) continue;
        let arr = buckets.get(gk); if (!arr) { arr = []; buckets.set(gk, arr); }
        arr.push(it);
      }

      // Anchor por grupo: main procedure + role cirurgião principal quando possível.
      const isCirurgiaoPrincipal = (role: string | null | undefined) => {
        const s = String(role ?? "").toLowerCase();
        return /cirurg/.test(s) && !/aux/.test(s) && !/instrument/.test(s);
      };
      for (const [gk, arr] of buckets) {
        const withMeta = arr.map((it) => ({ it, res: resultByItemId.get((it as any).id) }));
        const anchor =
          withMeta.find((x) => x.res?.is_main_procedure && isCirurgiaoPrincipal(x.it.doctor_role)) ??
          withMeta.find((x) => x.res?.is_main_procedure) ??
          withMeta.find((x) => isCirurgiaoPrincipal(x.it.doctor_role)) ??
          withMeta[0];
        if (anchor?.it) groups.set(gk, { anchor: anchor.it, groupItems: arr });
      }

      // 3) Para cada regra de bônus × grupo, testa aplicabilidade e emite linha.
      for (const rule of activeBonusRules) {
        const calcs = Array.isArray((rule as any).calculations) ? (rule as any).calculations : [];
        const bonusCalc = calcs.find((c: any) => (c?.calculation_type ?? "") === "bonus") ?? null;

        for (const [gk, { anchor, groupItems }] of groups) {
          // Se o worker é per-company, restringe às empresas do worker.
          if (company_name && typeof company_name === "string") {
            if ((anchor.company_name ?? "") !== company_name) continue;
          }

          // 3a) Rule-level: reutiliza selectWinningRule com APENAS esta regra
          //     como candidata (aplica escopo hospital/medico/grupo/pj,
          //     agreement, allowed_access_routes, sector, etc).
          let ruleApplies = false;
          try {
            const sel = selectWinningRule(anchor, [rule as any], ctx);
            ruleApplies = !!sel?.rule && sel.rule.id === (rule as any).id;
          } catch (_e) { ruleApplies = false; }
          if (!ruleApplies) continue;

          // 3b) Calc-level (time_mode / weekdays / includes_holidays / elective_mode
          //     / doctor_roles / sectors / agreement_aliases): calcItemMatches.
          if (bonusCalc) {
            try {
              const m = calcItemMatches(bonusCalc as any, anchor);
              if (!m.ok) continue;
            } catch (_e) { continue; }
          }

          // 3c) Base pela unidade de aplicação.
          const applicationUnit =
            (bonusCalc?.application_unit as string | null) ??
            ((rule as any).application_unit as string | null) ??
            "por_atendimento";
          let base = 0;
          if (applicationUnit === "por_item") {
            base = Number(anchor.procedure_amount ?? 0);
          } else {
            for (const it of groupItems) base += Number(it.procedure_amount ?? 0);
          }

          // 3d) Valor do bônus (rule-level ou calc-level; calc vence).
          const fixed = Number(
            (bonusCalc?.bonus_amount ?? (rule as any).bonus_amount) ?? 0,
          );
          const pct = Number(
            (bonusCalc?.bonus_pct ?? (rule as any).bonus_pct) ?? 0,
          );
          if (!fixed && !pct) continue; // regra mal configurada — não emite
          const pctAmt = Number((base * (pct / 100)).toFixed(2));
          const bonusAmt = Number((fixed + pctAmt).toFixed(2));
          if (!(bonusAmt > 0)) continue;

          const compKey = (anchor.company_name ?? "Sem empresa").trim() || "Sem empresa";
          bonusTotalByCompany[compKey] = (bonusTotalByCompany[compKey] ?? 0) + bonusAmt;
          if (anchor.company_name) bonusCompanyNames.add(anchor.company_name);

          const ruleLabel = (rule as any).name ?? "Bônus";
          const ruleId = (rule as any).id ?? null;

          bonusLinesToInsert.push({
            payment_id,
            hospital_id: __paymentHospitalId,
            doctor_name: anchor.doctor_name ?? null,
            doctor_id: (anchor as any).doctor_id ?? null,
            company_name: anchor.company_name ?? null,
            company_id: (anchor as any).company_id ?? null,
            attendance_number: anchor.attendance_number ?? null,
            patient_name: (anchor as any).patient_name ?? null,
            sector: (anchor as any).sector ?? null,
            procedure_date: (anchor as any).procedure_date ?? null,
            gross_amount: bonusAmt,
            expected_amount: bonusAmt,
            procedure_name: ruleLabel,
            tipo_linha: "complemento_bonus",
            tipo_item: "bonus",
            item_origem: "pagamento_atual",
            origem_referencia: (anchor as any).id ?? null,
            applied_calc_method: "bonus",
            applied_rule_label: ruleLabel,
            applied_rule_id: ruleId,
            // Tarefa 2 — decomposição do bônus (colunas dedicadas).
            // Torna auditável "base R$ X + bônus fixo R$ Y + bônus % R$ Z = pago".
            bonus_base_amount: Number(base.toFixed(2)),
            bonus_fixed_amount: Number(fixed.toFixed(2)),
            bonus_pct_amount: pctAmt,
            ai_status: "aprovado",
            applied_at: new Date().toISOString(),
            synthetic_bonus: true,
            ai_findings: {
              expected_amount: bonusAmt,
              calculation_type: "bonus",
              applied_rule_label: ruleLabel,
              applied_rule_id: ruleId,
              application_unit: applicationUnit,
              base_used: Number(base.toFixed(2)),
              bonus_fixed: Number(fixed.toFixed(2)),
              bonus_pct_amount: pctAmt,
              alerts: [],
            },
            validation_findings: [],
            convenio_value_totalized: false,
            authorized_exception: false,
            empresa_tem_pool: false,
          });
        }
      }

    }


    // Helper: executa promessas em chunks paralelos (limita conexões simultâneas).
    const runChunked = async <T,>(arr: T[], size: number, fn: (x: T) => Promise<unknown>) => {
      for (let i = 0; i < arr.length; i += size) {
        await Promise.all(arr.slice(i, i + size).map(fn));
      }
    };

    // Updates por id em paralelo (chunks de 50). Não dá para fazer um único
    // UPDATE porque cada item tem um ai_findings diferente.
    //
    // RESILIÊNCIA A DEADLOCK (40P01): updates concorrentes sobre payment_items
    // podem colidir em locks de índice/trigger. Antes, um único deadlock abortava
    // toda a reanálise — itens já processados ficavam com applied_at do job atual
    // e os demais retinham ai_findings antigos, dando a sensação de "Reaplicar
    // regras não funciona". Agora cada UPDATE faz até 3 tentativas com backoff
    // (250ms, 500ms, 1000ms, 2000ms, 4000ms + jitter) quando o erro é
    // deadlock/serialization. Chunk reduzido de 10→5 para diminuir contenção
    // de locks de índice/trigger quando compute-company-financials e
    // apply-company-deductions rodam concorrentemente sobre o mesmo grupo.
    let __deadlock_retries = 0;
    let __deadlock_retries_succeeded = 0;
    const isTransientDbError = (msg: string) => {
      const m = (msg || "").toLowerCase();
      return m.includes("deadlock detected") || m.includes("40p01")
        || m.includes("could not serialize") || m.includes("40001")
        || m.includes("canceling statement due to statement timeout") || m.includes("statement timeout");
    };
    console.time(`${__t} writes_payment_items`);
    const __writesStart = Date.now();
    await runChunked(itemUpdates, 3, async (u) => {
      const patch: Record<string, unknown> = {
        ai_status: u.ai_status,
        ai_findings: u.ai_findings,
        attendance_group_key: u.attendance_group_key,
        specialty: u.specialty,
        sector: u.sector,
        // Sub-Onda 2A — colunas SQL nativas (espelham ai_findings)
        applied_rule_id: u.applied_rule_id,
        applied_rule_label: u.applied_rule_label,
        applied_calc_id: u.applied_calc_id,
        applied_calc_method: u.applied_calc_method,
        expected_amount: u.expected_amount,
        applied_at: u.applied_at,
        convenio_basis_detected: (u as any).convenio_basis_detected,
        basis_confidence: (u as any).basis_confidence,
        // Pacote: marca/desmarca absorção (idempotente em reanálise).
        package_absorbed: u.package_absorbed === true,
        package_absorbed_calc_id: u.package_absorbed_calc_id ?? null,
        package_ambiguity: (u as any).package_ambiguity ?? null,
        // Cache determinístico da IA
        ai_input_hash: u.ai_input_hash ?? null,
        ai_cached_at: u.ai_cached_at ?? null,
      };
      // CONFECÇÃO: motor PRODUZ o gross_amount (valor a pagar) a partir do
      // expected_amount calculado pela regra. Sem regra (sem_regra ou bloqueio
      // por duplicidade de cálculo) → grava null e mantém alerta — coerente
      // com "motor nunca aplica default hardcoded de repasse".
      // Respeita override manual (acatar/ajuste do analista): se gross_override_at
      // está setado, NÃO sobrescreve gross_amount.
      if (isConfeccao) {
        const srcItem = items.find((it: any) => it.id === u.id) as any;
        if (!srcItem?.gross_override_at) {
          patch.gross_amount = u.expected_amount ?? null;
        }
      }
      // 2026-06-26: reduzido para 4 tentativas (cap ~3.75s) — backoff longo
      // estava consumindo o orçamento de 150s do edge runtime e estourando em
      // IDLE_TIMEOUT (504). Deadlocks transitórios serão re-enfileirados pela
      // retry queue (`enqueue_ai_retry`) em vez de retentados aqui dentro.
      const delays = [250, 500, 1000, 2000];
      let attempt = 0;
      let lastErr: string | null = null;
      while (attempt <= delays.length) {
        const { error: updateErr } = await supabase.from("payment_items").update(patch).eq("id", u.id);
        if (!updateErr) {
          if (attempt > 0) __deadlock_retries_succeeded++;
          return;
        }
        lastErr = updateErr.message;
        if (!isTransientDbError(updateErr.message) || attempt === delays.length) {
          throw new Error(`Falha ao atualizar item ${u.id}: ${updateErr.message}`);
        }
        __deadlock_retries++;
        const jitter = Math.floor(Math.random() * 50);
        await new Promise((r) => setTimeout(r, delays[attempt] + jitter));
        attempt++;
      }
      throw new Error(`Falha ao atualizar item ${u.id} após retries: ${lastErr}`);
    });
    console.timeEnd(`${__t} writes_payment_items`);
    if (isConfeccao) {
      const updatesById = new Map(itemUpdates.map((u) => [u.id, u]));
      for (const it of items as any[]) {
        const u = updatesById.get(it.id);
        if (!u) continue;
        it.expected_amount = u.expected_amount ?? null;
        if (!it.gross_override_at) {
          it.gross_amount = u.expected_amount ?? 0;
        }
      }
    }
    if (__deadlock_retries > 0) {
      (diagnostics as any).deadlock_retries = __deadlock_retries;
      (diagnostics as any).deadlock_retries_succeeded = __deadlock_retries_succeeded;
      (diagnostics as any).status_note = "partial_with_retry";
      console.warn(`${__t} payment_items_update: ${__deadlock_retries} retries por deadlock (${__deadlock_retries_succeeded} bem-sucedidos)`);
    }

    // ---------- Auditoria: registra mudanças de package_absorbed feitas pelo motor ----------
    // Cada transição (false→true ou true→false) gera uma linha em audit_log com
    // entity_type='payment_item', action='update', diff contendo o estado anterior/novo,
    // o calc_id responsável pela absorção e o motivo. Sem actor_id (motor automático).
    try {
      const oldAbsorbedById = new Map<string, boolean>();
      for (const it of items as any[]) {
        oldAbsorbedById.set(it.id, it.package_absorbed === true);
      }
      const auditRows: Record<string, unknown>[] = [];
      for (const u of itemUpdates) {
        const oldVal = oldAbsorbedById.get(u.id) ?? false;
        const newVal = u.package_absorbed === true;
        if (oldVal === newVal) continue;
        const srcItem = (items as any[]).find((it) => it.id === u.id);
        auditRows.push({
          entity_type: "payment_item",
          entity_id: u.id,
          action: "update",
          actor_id: null,
          company_id: srcItem?.company_id ?? null,
          company_name: srcItem?.company_name ?? null,
          hospital_id: (payment as any)?.hospital_id ?? null,
          diff: {
            package_absorbed: { before: oldVal, after: newVal },
            package_absorbed_calc_id: {
              before: srcItem?.package_absorbed_calc_id ?? null,
              after: u.package_absorbed_calc_id ?? null,
            },
            source: "analyze-payment",
            reason: newVal ? "package_secondary_absorbed" : "package_absorption_cleared",
            applied_rule_id: u.applied_rule_id ?? null,
            applied_calc_method: u.applied_calc_method ?? null,
            ai_findings_engine: (u.ai_findings as any)?.engine ?? null,
          },
        });
      }
      if (auditRows.length > 0) {
        for (let i = 0; i < auditRows.length; i += 200) {
          const slice = auditRows.slice(i, i + 200);
          const { error: auditErr } = await supabase.from("audit_log").insert(slice);
          if (auditErr) console.warn(`${__t} audit_package_absorbed_error`, auditErr.message);
        }
        console.log(`${__t} audit_package_absorbed_logged count=${auditRows.length}`);
      }
    } catch (e: any) {
      console.warn(`${__t} audit_package_absorbed_exception`, e?.message ?? String(e));
    }

    // Idempotência: apaga linhas de bônus prévias deste payment para as
    // empresas que este worker está processando — evita duplicar em reanálise.
    if (bonusCompanyNames.size > 0) {
      await supabase
        .from("payment_items")
        .delete()
        .eq("payment_id", payment_id)
        .eq("tipo_linha", "complemento_bonus")
        .eq("tipo_item", "bonus")
        .in("company_name", Array.from(bonusCompanyNames));
    }
    if (bonusLinesToInsert.length > 0) {
      for (let i = 0; i < bonusLinesToInsert.length; i += 200) {
        const slice = bonusLinesToInsert.slice(i, i + 200);
        const { error: bonusErr } = await supabase.from("payment_items").insert(slice);
        if (bonusErr) console.error(`${__t} bonus_insert_error`, bonusErr);
      }
      // Garante que o cálculo de total_amount dos grupos inclua as novas linhas.
      for (const b of bonusLinesToInsert) {
        items.push({
          id: `__bonus_${(b.origem_referencia as string) ?? Math.random()}`,
          doctor_name: (b.doctor_name as string) ?? null,
          doctor_id: (b.doctor_id as string) ?? null,
          company_name: (b.company_name as string) ?? null,
          company_id: (b.company_id as string) ?? null,
          gross_amount: Number(b.gross_amount ?? 0),
        } as unknown as ItemInput);
      }
    }

    // Inserts em bulk (uma chamada por tabela; chunked por segurança em lotes grandes).
    if (versionRows.length) {
      // UPSERT em (item_id, version) para evitar perda silenciosa por unique
      // violation quando workers paralelos calculam a mesma "next version"
      // a partir do mesmo prevByItem. Em colisão, sobrescreve com o resultado
      // mais recente (mesmo item + mesma versão = mesma tentativa de análise).
      for (let i = 0; i < versionRows.length; i += 200) {
        const { error: verErr } = await supabase
          .from("ai_analysis_versions")
          .upsert(versionRows.slice(i, i + 200), { onConflict: "item_id,version" });
        if (verErr) console.error(`${__t} ai_analysis_versions_upsert_error`, verErr);
      }
    }
    if (obsRows.length) {
      for (let i = 0; i < obsRows.length; i += 200) {
        const { error: obsErr } = await supabase.from("payment_observations").insert(obsRows.slice(i, i + 200));
        if (obsErr) console.error(`${__t} payment_observations_insert_error`, obsErr);
      }
    }

    // ---------- 9. Resumo do pagamento ----------
    // Worker por empresa (company_name setado): consolida determinístico lendo
    // ai_status de TODOS os itens do lote (não só da empresa), evitando que o
    // ai_summary fique stale com dados parciais da última empresa processada.
    // Worker global (sem company_name): mantém narrativa via IA como antes.
    let summary: string;
    if (company_name) {
      const counts = { aprovado: 0, alerta: 0, reprovado: 0, pendente: 0 };
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error: cntErr } = await supabase
          .from("payment_items")
          .select("ai_status")
          .eq("payment_id", payment_id)
          .range(from, from + pageSize - 1);
        if (cntErr) {
          console.error(`${__t} consolidated_count_error`, cntErr);
          break;
        }
        for (const r of (page ?? [])) {
          const s = (r as any).ai_status as string;
          if (s in counts) (counts as any)[s] += 1;
        }
        if (!page || page.length < pageSize) break;
      }
      const total = counts.aprovado + counts.alerta + counts.reprovado + counts.pendente;
      summary = `Lote com ${total} item(ns): ${counts.aprovado} aprovado(s), ${counts.alerta} alerta(s), ${counts.reprovado} reprovado(s).`;
    } else {
      summary = isConfeccao
        ? `Confecção concluída: repasse calculado para ${results.length} item(ns) conforme regras cadastradas.`
        : ((aiJustifications as any).__summary
          || `Motor analisou ${results.length} item(ns): ${results.length - alerts - blocks} aprovado(s), ${alerts} alerta(s), ${blocks} reprovado(s).`);
    }

    // IMPORTANTE: NÃO escrevemos `payments.status` aqui. O status do pagamento
    // é derivado dos statuses dos `payment_company_groups` pelo trigger
    // `recompute_payment_status_from_groups`. Tentar setar manualmente cria
    // condição de corrida: se a reanálise rodar logo depois do analista enviar
    // para validação, podemos sobrescrever `aguardando_validacao` com
    // `revisao_analista` e o lote "some" da fila do validador.
    // A reanálise apenas atualiza ai_summary/specialties; mudanças em grupos
    // (ver bloco 10) disparam o trigger que recalcula o status quando devido.
    const ANALYST_OWNED_FOR_REWRITE = new Set([
      "rascunho",
      "em_analise_ia",
      "revisao_analista",
      "devolvido_analista",
    ]);
    const { data: curPay } = await supabase
      .from("payments")
      .select("status")
      .eq("id", payment_id)
      .maybeSingle();
    const curStatus = (curPay?.status ?? "") as string;
    const paymentUpdate: Record<string, unknown> = { ai_summary: summary };
    // Persiste especialidade dominante do lote (>51%) para rastreabilidade.
    if (dominantSpecialty) paymentUpdate.specialties = [dominantSpecialty];
    await supabase.from("payments").update(paymentUpdate).eq("id", payment_id);

    const consolidatedDiff = itemDiffSummaries.length
      ? `\nMudanças nesta rodada (${itemDiffSummaries.length} item(ns)):\n` +
        itemDiffSummaries.slice(0, 8).map((d) => `• ${d.doctor}: ${d.diff}`).join("\n") +
        (itemDiffSummaries.length > 8 ? `\n…e mais ${itemDiffSummaries.length - 8} item(ns).` : "")
      : "";

    // Só registra como transição em_analise_ia → revisao_analista quando o
    // pagamento estava efetivamente com o analista. Caso contrário, registra
    // como reanálise informativa, sem mexer nos status_from/status_to (para
    // não poluir o histórico nem fazer parecer que o lote voltou ao analista).
    const obsTransition = ANALYST_OWNED_FOR_REWRITE.has(curStatus);
    // Em CONFECÇÃO o status (análise) não muda — fica em 'rascunho' como
    // placeholder enquanto confeccao_status='em_confeccao' carrega a fase real.
    const obsStatusTo = isConfeccao ? "rascunho" : "revisao_analista";
    await supabase.from("payment_observations").insert({
      payment_id,
      hospital_id: __paymentHospitalId,
      author_type: "ia",
      message: `${summary} (${alerts} alertas, ${blocks} reprovações)${consolidatedDiff}`,
      status_from: obsTransition ? "em_analise_ia" : null,
      status_to: obsTransition ? obsStatusTo : null,
    });

    // Auditoria por lote: confirma explicitamente que `specialty` foi ignorada
    // na seleção de regras de TODOS os itens deste lote. Fica no histórico
    // (payment_observations) e pode ser auditado depois.
    const itemsWithSpecialty = (itemsRaw ?? []).filter((x: any) => {
      const v = x?.__resolved_specialty?.value ?? x?.specialty;
      return v != null && String(v).trim() !== "";
    }).length;
    await supabase.from("payment_observations").insert({
      payment_id,
      hospital_id: __paymentHospitalId,
      author_type: "sistema",
      message:
        `Auditoria do motor: especialidade médica IGNORADA na seleção de regras ` +
        `(regra de projeto). ${results.length} item(ns) avaliado(s); ` +
        `${itemsWithSpecialty} com especialidade resolvida (apenas para relatório/filtro). ` +
        `Eixos efetivamente usados: setor, código TUSS, médico, empresa, grupo, convênio, via de acesso, função, data. ` +
        `Detalhe por item em ai_findings.decision_fields.`,
    });

    // ---------- 10. Grupos por empresa (Consolidação via normName) ----------
    // Carrega todos os grupos atuais do lote para decidir entre UPDATE, INSERT ou DELETE (limpeza).
    console.time(`${__t} upsert_company_groups`);
    const { data: existingGroups } = await supabase
      .from("payment_company_groups")
      .select("id,company_name,status")
      .eq("payment_id", payment_id);

    const groupsMap = new Map<string, { company_id: string | null; company_name: string; items: ItemInput[] }>();
    for (const it of items) {
      const name = (it.company_name ?? "Sem empresa").trim() || "Sem empresa";
      const key = normName(name);
      const cur = groupsMap.get(key);
      if (cur) {
        cur.items.push(it);
        // Prioriza o nome que tem acentos/case original se houver diferença
        if (name !== cur.company_name && name.length > cur.company_name.length) {
           cur.company_name = name;
        }
      }
      else groupsMap.set(key, { company_id: it.company_id, company_name: name, items: [it] });
    }

    const processedGroupIds = new Set<string>();

    for (const [key, g] of groupsMap.entries()) {
      const total = g.items.reduce((s, x) => s + Number(x.gross_amount), 0);
      
      // Busca grupo existente que bata com o nome normalizado
      const existing = (existingGroups ?? []).find(eg => normName(eg.company_name) === key);

      if (existing) {
        processedGroupIds.add(existing.id);
        const groupUpd: Record<string, unknown> = {
          items_count: g.items.length,
          total_amount: total,
          company_id: g.company_id,
          // Atualiza o nome para o "mais completo/correto" encontrado nos itens
          company_name: g.company_name,
        };
        if (ANALYST_OWNED_FOR_REWRITE.has((existing as any).status as string)) {
          // Confecção: status placeholder + confeccao_status vivo (trigger DB
          // exige status ∈ rascunho/arquivado/cancelado quando mode=confeccao).
          // Histórico: cai em `revisao_analista` como num lote normal — o
          // analista revisa e depois conclui explicitamente para virar `pago`.
          groupUpd.status = isConfeccao ? "rascunho" : "revisao_analista";
          if (isConfeccao) groupUpd.confeccao_status = "em_confeccao";
        }
        await supabase.from("payment_company_groups").update(groupUpd).eq("id", existing.id);
      } else {
        const { data: newG, error: grpErr } = await supabase.from("payment_company_groups").insert({
          payment_id,
          hospital_id: __paymentHospitalId,
          company_id: g.company_id,
          company_name: g.company_name,
          status: isConfeccao ? "rascunho" : "revisao_analista",
          confeccao_status: isConfeccao ? "em_confeccao" : null,
          items_count: g.items.length,
          total_amount: total,
        }).select("id").single();
        if (grpErr) console.error(`${__t} payment_company_groups_insert_error`, grpErr);
        if (newG) processedGroupIds.add(newG.id);
      }

    }

    // Limpeza: só é segura em análise global. Em análise por empresa, cada worker
    // enxerga apenas seus próprios itens; apagar os "não processados" removeria
    // grupos de empresas que já finalizaram e faria a tela mostrar só 1 empresa.
    if (!company_name) {
      const groupsToRemove = (existingGroups ?? []).filter(eg => !processedGroupIds.has(eg.id));
      if (groupsToRemove.length > 0) {
        const idsToRemove = groupsToRemove.map(eg => eg.id);
        console.log(`Limpando ${idsToRemove.length} grupos órfãos do lote ${payment_id}`);
        await supabase.from("payment_company_groups").delete().in("id", idsToRemove);
      }
    }
    console.timeEnd(`${__t} upsert_company_groups`);

    // ===== Verificação pós-split de bônus =====
    // Garante que os totais não regrediram após mover o bônus para uma linha
    // independente. Três invariantes:
    //  (1) por empresa: soma(expected) dos itens persistidos = pré-split (somar
    //      o expected dos pais antes da reversão deve bater com expected pós +
    //      expected das novas linhas de bônus).
    //  (2) por empresa: total_amount do payment_company_groups = soma(gross)
    //      dos itens da empresa no DB (inclui linhas de bônus).
    //  (3) lote: soma(total_amount) dos grupos = soma(gross) de TODOS os itens
    //      do payment no DB.
    // Divergências viram payment_observation (sistema) com tipo `aviso` e log.
    if (bonusLinesToInsert.length > 0) {
      try {
        const EPS = 0.05;
        const compsToCheck = Array.from(new Set([
          ...Object.keys(bonusTotalByCompany),
          ...Object.keys(preSplitExpectedByCompany),
        ]));

        // Lê itens persistidos das empresas afetadas (com paginação leve).
        const itemsByCompany: Record<string, { gross: number; expected: number; bonus: number }> = {};
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data: page, error: vErr } = await supabase
            .from("payment_items")
            .select("company_name,gross_amount,expected_amount,tipo_item")
            .eq("payment_id", payment_id)
            .range(from, from + PAGE - 1);
          if (vErr) { console.error(`${__t} verify_read_error`, vErr); break; }
          for (const row of (page ?? [])) {
            const r = row as any;
            const key = (r.company_name ?? "Sem empresa").toString().trim() || "Sem empresa";
            const bucket = itemsByCompany[key] ?? (itemsByCompany[key] = { gross: 0, expected: 0, bonus: 0 });
            bucket.gross += Number(r.gross_amount ?? 0);
            bucket.expected += Number(r.expected_amount ?? 0);
            if (r.tipo_item === "bonus") bucket.bonus += Number(r.expected_amount ?? 0);
          }
          if (!page || page.length < PAGE) break;
        }

        // Lê grupos atualizados.
        const { data: groupsAfter } = await supabase
          .from("payment_company_groups")
          .select("company_name,total_amount")
          .eq("payment_id", payment_id);
        const groupTotalByCompany: Record<string, number> = {};
        let scopedGroupsTotalSum = 0;
        for (const g of (groupsAfter ?? [])) {
          const key = (g as any).company_name?.toString().trim() || "Sem empresa";
          const t = Number((g as any).total_amount ?? 0);
          groupTotalByCompany[key] = (groupTotalByCompany[key] ?? 0) + t;
          if (compsToCheck.includes(key)) scopedGroupsTotalSum += t;
        }

        const divergences: string[] = [];

        // (1) bônus extraído == bônus persistido
        for (const comp of compsToCheck) {
          const expectedBonus = Number((bonusTotalByCompany[comp] ?? 0).toFixed(2));
          const persistedBonus = Number((itemsByCompany[comp]?.bonus ?? 0).toFixed(2));
          if (Math.abs(expectedBonus - persistedBonus) > EPS) {
            divergences.push(
              `[${comp}] bônus extraído R$ ${expectedBonus.toFixed(2)} ≠ bônus persistido R$ ${persistedBonus.toFixed(2)}`,
            );
          }
        }

        // (2) total_amount do grupo == soma(gross) dos itens da empresa
        for (const comp of compsToCheck) {
          const grossDb = Number((itemsByCompany[comp]?.gross ?? 0).toFixed(2));
          const groupTotal = Number((groupTotalByCompany[comp] ?? 0).toFixed(2));
          if (Math.abs(grossDb - groupTotal) > EPS) {
            divergences.push(
              `[${comp}] grupo total_amount R$ ${groupTotal.toFixed(2)} ≠ Σ gross itens R$ ${grossDb.toFixed(2)}`,
            );
          }
        }

        // (3) escopo processado: em worker por empresa, outras empresas podem
        // estar stale de reanálises anteriores; não devem gerar falso alerta na
        // empresa atual. Em análise global, compsToCheck cobre o lote inteiro.
        const scopedGross = compsToCheck.reduce((s, comp) => s + (itemsByCompany[comp]?.gross ?? 0), 0);
        if (Math.abs(scopedGross - scopedGroupsTotalSum) > EPS) {
          divergences.push(
            `[escopo bônus] Σ grupos R$ ${scopedGroupsTotalSum.toFixed(2)} ≠ Σ gross itens R$ ${scopedGross.toFixed(2)}`,
          );
        }

        if (divergences.length > 0) {
          const msg =
            `⚠️ Divergência pós-split de bônus (${bonusLinesToInsert.length} linha(s) inserida(s)) — REVISÃO MANUAL OBRIGATÓRIA antes de aprovar: ` +
            divergences.join(" · ");
          console.error(`${__t} bonus_split_invariant_failed`, msg);
          // Marca diagnóstico do lote para bloquear aprovação automática e
          // sinalizar na UI que os valores gravados podem estar inconsistentes.
          (diagnostics as any).bonus_split_invariant_failed = true;
          (diagnostics as any).bonus_split_divergences = divergences;
          (diagnostics as any).requires_manual_review = true;
          await supabase.from("payment_observations").insert({
            payment_id,
            hospital_id: __paymentHospitalId,
            author_type: "sistema",
            observation_type: "alerta",
            message: msg,
          });
          // Observação com observation_type="alerta" já é suficiente para o
          // Card de "Alertas do sistema" da UI destacar o lote — não criamos
          // pendência aqui porque a tabela `pendencias` é paciente-cêntrica
          // (event_date, patient_name, agreement_name obrigatórios) e não
          // aceita registros de integridade sem esses campos.
        } else {
          console.log(
            `${__t} bonus_split_invariants_ok bonus_lines=${bonusLinesToInsert.length} companies=${compsToCheck.length}`,
          );
        }
      } catch (verifyErr) {
        console.error(`${__t} bonus_split_verify_error`, verifyErr);
      }
    }



    // Notifica o analista que a IA concluiu (Evento 2)
    if (obsTransition) {
      console.log(`Triggering notify-analyst-event (ia_concluded) for payment ${payment_id}`);
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-analyst-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ paymentId: payment_id, eventType: "ia_concluded" }),
      }).catch(e => console.error("Failed to notify analyst (ia_concluded):", e));
    }

    // ---------- 11. Atualiza Diagnósticos no Banco ----------
    // 2026-06-24: analyze-payment é invocado UMA VEZ POR EMPRESA. Antes, cada
    // invocação sobrescrevia `processing_diagnostics` e zerava
    // `processing_timeout_occurred` — a última empresa apagava o registro de
    // falhas das anteriores. Agora fazemos MERGE preservando o status por
    // empresa em `per_company`, e só limpamos o flag de timeout se NENHUMA
    // empresa registrou falha/parcial-IA. O reset completo acontece no
    // dispatch (início de nova reanálise).
    diagnostics.execution_time_ms = Date.now() - startTime;
    diagnostics.status = "success";
    diagnostics.total_items = results.length;
    diagnostics.ai_processed_items = itemsToReview.length;
    diagnostics.ai_chunks_total = __telemetry.ai_chunks_total ?? 0;
    diagnostics.ai_chunks_failed = __telemetry.ai_chunks_failed ?? 0;
    const __companyKey = __company_label ?? __company_name ?? "Sem empresa";
    const __thisPartial = (__telemetry.ai_chunks_failed ?? 0) > 0;

    console.time(`${__t} update_payments_diagnostics`);
    // Lê estado atual para merge (não-bloqueante: se falhar, prossegue sem merge)
    const { data: __existingPay } = await supabase
      .from("payments")
      .select("processing_diagnostics, processing_timeout_occurred")
      .eq("id", payment_id)
      .maybeSingle();
    const __existingDiag = (__existingPay?.processing_diagnostics ?? {}) as Record<string, any>;
    const __perCompany = (__existingDiag.per_company ?? {}) as Record<string, any>;
    __perCompany[__companyKey] = {
      status: "success",
      total_items: results.length,
      ai_processed_items: itemsToReview.length,
      ai_chunks_total: __telemetry.ai_chunks_total ?? 0,
      ai_chunks_failed: __telemetry.ai_chunks_failed ?? 0,
      execution_time_ms: Date.now() - startTime,
      partial_ai_failure: __thisPartial,
      finished_at: new Date().toISOString(),
    };
    const __anyPartial = Object.values(__perCompany).some((c: any) => c?.partial_ai_failure === true);
    const __anyError = Object.values(__perCompany).some((c: any) => c?.status === "error");
    const __mergedDiag = {
      ...__existingDiag,
      ...diagnostics,
      per_company: __perCompany,
      partial_ai_failure: __anyPartial,
      has_company_error: __anyError,
    };
    await supabase.from("payments").update({
      processing_diagnostics: __mergedDiag,
      // Só limpa o flag se nenhuma empresa registrou erro
      processing_timeout_occurred: __anyError ? true : false,
    }).eq("id", payment_id);
    console.timeEnd(`${__t} update_payments_diagnostics`);


    // Reporta progresso ao job de dispatch (se houver)
    if (_job_id) {
      try {
        console.time(`${__t} increment_progress`);
        const { data: jobStatus, error: jobErr } = await supabase.rpc("increment_processing_progress", {
          _job_id,
          _company_name: _company_label ?? company_name ?? "Sem empresa",
          _error: null,
        });
        __progress_reported = true;
        console.timeEnd(`${__t} increment_progress`);

        if (!jobErr && jobStatus && (jobStatus.status === "concluido" || jobStatus.status === "parcial")) {
          const successCount = jobStatus.processed_companies - (jobStatus.failed_companies?.length ?? 0);
          const failCount = jobStatus.failed_companies?.length ?? 0;
          const reason = `${successCount} sucesso(s), ${failCount} falha(s).`;
          
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-analyst-event`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ 
              paymentId: payment_id, 
              eventType: "ia_concluded",
              reason
            }),
          }).catch(e => console.error("Failed to notify analyst (job_finished):", e));
        }
      } catch (e) {
        console.error("Falha ao reportar progresso", e);
      }
    }

    // [Sprint 4 - Observabilidade] Grava telemetria por empresa (best-effort).
    __telemetry.items_count = results.length;
    try {
      // Mesmo no caminho de sucesso, gravamos um marker no campo `error` quando
      // chunks de IA falharam — fica visível nos dashboards de saúde sem exigir
      // migration de schema.
      const aiPartialNote = __telemetry.ai_chunks_failed > 0
        ? `ai_partial_failure: ${__telemetry.ai_chunks_failed}/${__telemetry.ai_chunks_total} chunks falharam (retries: ${__telemetry.ai_chunks_retried})`
        : null;
      await supabase.from("analysis_telemetry").insert({
        job_id: __job_id ?? null,
        payment_id,
        hospital_id: __paymentHospitalId,
        company_name: __company_label ?? __company_name ?? null,
        total_ms: Date.now() - startTime,
        ai_ms: __telemetry.ai_ms,
        rules_ms: __telemetry.rules_ms,
        writes_ms: Date.now() - (__writesStart ?? startTime),
        items_count: __telemetry.items_count,
        ai_items_count: __telemetry.ai_items_count,
        ai_items_skipped_cache: __telemetry.ai_items_skipped_cache,
        cache_hit: __telemetry.cache_hit,
        error: aiPartialNote,
      });
    } catch (telErr) {
      console.warn(`${__t} telemetry insert falhou`, (telErr as any)?.message ?? telErr);
    }


    // --- Aprendizado: persiste aliases de convênio descobertos durante a análise ---
    // Sempre que normAgreement resolveu um raw via stem-rule ou startsWith,
    // o raw foi registrado. Aqui fazemos merge não-destrutivo em convenios.aliases.
    // ⚠️ Pulamos em import_mode='historico' para não contaminar o cadastro com
    // variações de bases antigas que estamos só usando para popular DRE.
    if (isHistorico) {
      drainLearnedAliases(); // drena e descarta para limpar o buffer do worker
      console.log(`${__t} [historico] auto-aprendizado de aliases de convênio pulado`);
    } else try {

      const learned = drainLearnedAliases();
      if (learned.length) {
        for (const { slug, aliases } of learned) {
          if (!slug || !aliases.length) continue;
          const { data: existing } = await supabase
            .from("convenios")
            .select("aliases")
            .eq("slug", slug)
            .maybeSingle();
          const cur: string[] = Array.isArray((existing as any)?.aliases) ? (existing as any).aliases : [];
          const seen = new Set(cur.map((x) => String(x).trim().toLowerCase()));
          const fresh = aliases.filter((a) => !seen.has(a.trim().toLowerCase()));
          if (fresh.length) {
            const merged = [...cur, ...fresh];
            await supabase
              .from("convenios")
              .update({ aliases: merged, updated_at: new Date().toISOString() })
              .eq("slug", slug);
            console.log(`${__t} [learn-convenio] ${slug}: +${fresh.length} alias(es): ${fresh.slice(0, 3).join(" | ")}${fresh.length > 3 ? "..." : ""}`);
          }
          // Espelha em convenio_aliases (source='auto') para o pipeline estrito
          // aprender junto com a tabela legada. Idempotente: ignora duplicidade
          // do índice único alias_normalized.
          if (aliases.length) {
            // Escopa o alias aprendido ao hospital do pagamento — evita que um
            // apelido aprendido no DF Star vaze e case convênio no Santa Luzia.
            const rows = aliases.map((a) => ({
              convenio_slug: slug,
              alias_text: a,
              source: "auto" as const,
              hospital_id: __paymentHospitalId,
            }));
            const { error: aliasErr } = await supabase.from("convenio_aliases").insert(rows);
            if (aliasErr && !/duplicate|unique|conflict/i.test(aliasErr.message ?? "")) {
              console.warn(`${__t} [learn-convenio] convenio_aliases insert falhou: ${aliasErr.message}`);
            }
          }
        }
      }
    } catch (learnErr) {
      console.warn(`${__t} [learn-convenio] falha ao persistir aliases aprendidos`, (learnErr as any)?.message ?? learnErr);
    }


    // === Pass 3: Mínimo garantido ===
    // Dispara apply-minimum-guarantee (fire-and-forget). Failures não bloqueiam o
    // analyze-payment — a função é idempotente e pode ser reexecutada manualmente.
    try {
      void supabase.functions.invoke("apply-minimum-guarantee", {
        body: { payment_id: __payment_id },
      }).catch((e) => console.warn(`${__t} [apply-minimum-guarantee] falha não-fatal:`, (e as any)?.message ?? e));
    } catch (mgErr) {
      console.warn(`${__t} [apply-minimum-guarantee] erro ao disparar:`, (mgErr as any)?.message ?? mgErr);
    }

    // [Engine sources] Marca leitura de regras / modelo de remuneração para
    // esta PJ. O motor leu o snapshot de regras vigente — registra na tabela
    // de auditoria/gate. A finalização global (deduções/glosas/pool) é
    // disparada por orchestrate-analysis quando todas as PJs terminam.
    try {
      const appliedCount = results.filter((r: any) => r.applied_rule_id || r.applied_calc_id).length;
      await supabase.rpc("mark_engine_source", {
        _payment_id: __payment_id,
        _source: "rules",
        _applied_count: appliedCount,
        _total_value: 0,
        _job_id: null,
        _details: { total_items: results.length } as never,
      });
      await supabase.rpc("mark_engine_source", {
        _payment_id: __payment_id,
        _source: "payout_model",
        _applied_count: results.filter((r: any) => r.applied_calc_method).length,
        _total_value: 0,
        _job_id: null,
        _details: {} as never,
      });
    } catch (e) {
      console.warn(`${__t} [engine-sources] falha ao marcar rules/payout_model:`, (e as any)?.message ?? e);
    }



    return new Response(
      JSON.stringify({
        ok: true,
        alerts,
        blocks,
        total: results.length,
        ai_used: itemsToReview.length > 0,
        diagnostics
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("analyze-payment error", msg);

    // Registra erro de timeout ou outro
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    // Tenta extrair ID do pagamento das variáveis hoisted (req.json já foi consumido)
    try {
      if (__payment_id) {
        // Merge com diagnóstico existente (mesma lógica do success path).
        const { data: __existingErrPay } = await supabase
          .from("payments")
          .select("processing_diagnostics")
          .eq("id", __payment_id)
          .maybeSingle();
        const __existingErrDiag = (__existingErrPay?.processing_diagnostics ?? {}) as Record<string, any>;
        const __perCompanyErr = (__existingErrDiag.per_company ?? {}) as Record<string, any>;
        const __companyKeyErr = __company_label ?? __company_name ?? "Sem empresa";
        __perCompanyErr[__companyKeyErr] = {
          status: "error",
          error: msg.slice(0, 500),
          execution_time_ms: Date.now() - startTime,
          ai_chunks_total: __telemetry.ai_chunks_total ?? 0,
          ai_chunks_failed: __telemetry.ai_chunks_failed ?? 0,
          finished_at: new Date().toISOString(),
        };
        await supabase.from("payments").update({
          processing_timeout_occurred: true,
          processing_diagnostics: {
            ...__existingErrDiag,
            ...diagnostics,
            status: "error",
            error: msg,
            execution_time_ms: Date.now() - startTime,
            per_company: __perCompanyErr,
            has_company_error: true,
          }
        }).eq("id", __payment_id);
      }
      // Reporta falha ao job de dispatch (se houver)
      if (__job_id && !__progress_reported) {
        await supabase.rpc("increment_processing_progress", {
          _job_id: __job_id,
          _company_name: __company_label ?? __company_name ?? "Sem empresa",
          _error: msg.slice(0, 300),
        });
        __progress_reported = true;
      }
      // [Sprint 4] Telemetria de falha
      if (__payment_id) {
        await supabase.from("analysis_telemetry").insert({
          job_id: __job_id ?? null,
          payment_id: __payment_id,
          hospital_id: __paymentHospitalIdHoisted,
          company_name: __company_label ?? __company_name ?? null,
          total_ms: Date.now() - startTime,
          ai_ms: __telemetry.ai_ms,
          rules_ms: __telemetry.rules_ms,
          writes_ms: 0,
          items_count: __telemetry.items_count,
          ai_items_count: __telemetry.ai_items_count,
          ai_items_skipped_cache: __telemetry.ai_items_skipped_cache,
          cache_hit: __telemetry.cache_hit,
          error: msg.slice(0, 500),
        });
      }
    } catch (reportErr) {
      console.error("Falha ao reportar erro do worker:", reportErr);
    }

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    // [Sprint 1 - Tier 3.H] Safety net: se nem o success-path nem o catch
    // reportaram (ex.: exceção fora do try, kill abrupto da função), garante
    // 1 chamada para o job não travar em "99%".
    if (__job_id && !__progress_reported) {
      try {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await sb.rpc("increment_processing_progress", {
          _job_id: __job_id,
          _company_name: __company_label ?? __company_name ?? "Sem empresa",
          _error: "worker encerrou sem reportar progresso (finally safety-net)",
        });
      } catch (e) {
        console.error("Safety-net finally falhou:", e);
      }
    }
  }
}

