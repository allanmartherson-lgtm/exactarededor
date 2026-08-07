// dispatch-payment-analysis
// Cria o job de processamento e delega a orquestração das empresas para
// `orchestrate-analysis`, que processa em páginas auto-encadeadas (cada
// página numa execução independente com seu próprio timeout de 60s).
// Esta função retorna em <2s: não orquestra workers diretamente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_SIZE = 2; // [Sprint 1 - Tier 2.D] reduzido de 4→2 para aliviar pool Postgres enquanto regras não são cacheadas (Tier 1.B). Throughput cai ~30%, taxa de falha tende a 0.

const runInBackground = (promise: Promise<unknown>, label: string) => {
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const guarded = promise.catch((e) => console.error(`[dispatch] ${label}`, e));
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(guarded);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);
  try {

    const { payment_id, ai_statuses, tolerance_pct, only_companies, force_fresh_rules, skip_ai, run_ai, skip_parecer_cross_ref } = await req.json();
    // [2026-07-14] IA opt-in: default = motor puro. IA só quando run_ai===true
    // ou skip_ai===false explicitamente.
    const __skip_ai = run_ai === true ? false : (skip_ai === false ? false : true);
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fonte da verdade para quais empresas processar é payment_items.
    // payment_company_groups pode estar parcial quando algum worker falha ou
    // quando uma importação antiga ainda não consolidou todos os grupos.
    const itemCompanies: Array<{ company_name: string | null }> = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: page, error: itemsErr } = await supabase
        .from("payment_items")
        .select("company_name")
        .eq("payment_id", payment_id)
        .range(from, from + pageSize - 1);

      if (itemsErr) throw itemsErr;
      itemCompanies.push(...(page ?? []));
      if (!page || page.length < pageSize) break;
    }

    const counts: Record<string, number> = {};
    for (const it of (itemCompanies ?? [])) {
      const name = (it.company_name ?? "").trim() || "Sem empresa";
      counts[name] = (counts[name] ?? 0) + 1;
    }

    const groups = Object.entries(counts).map(([name, count]) => ({
      company_name: name,
      items_count: count,
    }));

    // Se houver filtro de status (alerta, reprovado), precisamos descobrir quais dessas empresas
    // possuem itens com esses status. Buscamos com um limite alto para cobrir lotes grandes.
    let companyNames: string[] = [];
    let totalItems = 0;

    if (ai_statuses && ai_statuses.length > 0) {
      const { data: itemsWithStatus, error: filterErr } = await supabase
        .from("payment_items")
        .select("company_name")
        .eq("payment_id", payment_id)
        .in("ai_status", ai_statuses)
        .limit(20000); // Limite alto para identificar empresas em lotes densos
      
      if (filterErr) throw filterErr;
      
      const filteredSet = new Set(
        (itemsWithStatus ?? []).map(r => (r.company_name ?? "").trim() || "Sem empresa")
      );
      
      const targetGroups = (groups ?? []).filter(g => {
        const name = (g.company_name ?? "").trim() || "Sem empresa";
        return filteredSet.has(name);
      });
      
      companyNames = targetGroups.map(g => (g.company_name ?? "").trim() || "Sem empresa");
      totalItems = targetGroups.reduce((acc, g) => acc + (g.items_count || 0), 0);
    } else {
      // Sem filtro: todas as empresas do lote
      companyNames = (groups ?? []).map(g => (g.company_name ?? "").trim() || "Sem empresa");
      totalItems = (groups ?? []).reduce((acc, g) => acc + (g.items_count || 0), 0);
    }
    
    // Filtro por empresas específicas (se fornecido - ex: reprocessar falhas ou uma empresa específica)
    if (Array.isArray(only_companies) && only_companies.length > 0) {
      const normalizedOnly = new Set(only_companies.map((s: any) => String(s).trim().toLowerCase()));
      companyNames = companyNames.filter(name => normalizedOnly.has(name.toLowerCase()));
      const allowed = new Set(companyNames.map((s) => s.toLowerCase()));
      totalItems = (groups ?? [])
        .filter((g) => allowed.has(((g.company_name ?? "").trim() || "Sem empresa").toLowerCase()))
        .reduce((acc, g) => acc + (g.items_count || 0), 0);
    }

    // Governança: empresas com status diferente dos "editáveis" NÃO devem ser
    // reanalisadas. O analista já concluiu (ou enviou para validação/aprovação)
    // — reanálise sobrescreveria dados validados sem rastro. Para reanalisar
    // uma empresa fechada, o analista deve REABRIR a empresa via UI.
    //
    // Os "editáveis" variam pelo modo do lote:
    //   - análise (padrão/isolado/empresa_prioritaria): status ∈ {revisao_analista, devolvido_analista}
    //   - confecção: grupos têm status='rascunho' (placeholder) e confeccao_status='em_confeccao'
    //     enquanto o analista não clica em "Finalizar confecção". Aceitamos o grupo
    //     se confeccao_status='em_confeccao'.
    const { data: paymentRow, error: payErr } = await supabase
      .from("payments")
      .select("analysis_mode, payment_type, competence_month, hospital_id, has_mixed_parecer")
      .eq("id", payment_id)
      .single();
    if (payErr) throw payErr;
    const isConfeccao = (paymentRow as any)?.analysis_mode === "confeccao";
    const paymentHospitalId = (paymentRow as any)?.hospital_id ?? null;
    if (!auth.is_internal && !assertCallerHospital(auth, paymentHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gate de Parecer: lotes do tipo 'parecer' exigem ao menos um relatório
    // de parecer importado para o período (payment_parecer_reports). Sem isso,
    // o analista não consegue distinguir visita sequencial vinda de parecer
    // (paga pelo convênio) de visita comum (regra normal). Bloqueia o
    // dispatch e devolve sinal para a UI cobrar o upload.
    //
    // Lote MISTO (payment_type='procedimento' + has_mixed_parecer=true) também
    // precisa passar pelo cross-reference quando há relatório, mas NÃO bloqueia
    // sem relatório — tem procedimentos que independem do relatório.
    const ptype = String((paymentRow as any)?.payment_type ?? "").toLowerCase();
    const hasMixedParecer = (paymentRow as any)?.has_mixed_parecer === true;
    const isPurePareceer = ptype.includes("parecer");
    const needsParecerCross = isPurePareceer || hasMixedParecer;
    if (!isConfeccao && needsParecerCross) {
      const { data: reports, error: repErr } = await supabase
        .from("payment_parecer_reports")
        .select("id")
        .eq("payment_id", payment_id)
        .limit(1);
      if (repErr) throw repErr;
      const hasReport = !!(reports && reports.length > 0);
      if (!hasReport && isPurePareceer) {
        return new Response(
          JSON.stringify({
            ok: false,
            blocked: true,
            reason: "missing_parecer_report",
            message:
              "Lote de Parecer exige o relatório de Parecer Solicitado/Respondido do Tasy antes de iniciar a análise.",
          }),
          {
            // Gate de negócio esperado: retorna 200 para a UI tratar como
            // estado bloqueado, sem virar erro global/runtime no preview.
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      // Lote misto sem relatório: segue direto para orquestração (não defere).
      if (hasReport) {


      // Lote de Parecer + relatório presente: rodar cross-reference ANTES da
      // análise garante que cada item esteja com o tipo (Parecer vs Visita)
      // correto sob as regras parametrizadas atuais. cross-reference-parecer
      // dispatch-a esta função de volta com skip_parecer_cross_ref=true ao
      // final, então saímos aqui sem orquestrar — sem isso, qualquer "rerun"
      // recalcularia regras em cima de uma classificação possivelmente stale.
      if (!skip_parecer_cross_ref) {
        runInBackground(
          fetch(`${SUPABASE_URL}/functions/v1/cross-reference-parecer`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            // Chama diretamente o worker real. A chamada sem `_background`
            // apenas agenda outro fetch e retorna 202; em cadeia fire-and-forget
            // isso pode encerrar antes do redispatch final ser criado.
            // Propaga o escopo original: sem isso o redispatch do cross-ref
            // reanalisava o lote inteiro (todas as empresas), o que é lento e
            // faz o clique em "Reaplicar regras" de UMA empresa se perder.
            body: JSON.stringify({
              payment_id,
              trigger_reanalysis: true,
              _background: true,
              reanalysis_options: {
                only_companies: Array.isArray(only_companies) && only_companies.length > 0 ? only_companies : undefined,
                ai_statuses: Array.isArray(ai_statuses) && ai_statuses.length > 0 ? ai_statuses : undefined,
                tolerance_pct,
                skip_ai: __skip_ai,
              },
            }),

          }).then(async (resp) => {
            const txt = await resp.text();
            if (!resp.ok) {
              console.error("[dispatch] cross-reference-parecer erro", resp.status, txt.slice(0, 500));
            }
          }),
          "cross-reference-parecer dispatch",
        );
        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            deferred_to: "cross-reference-parecer",
            message:
              "Lote de parecer: reclassificação Parecer/Visita disparada antes da análise.",
          }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      }
    }


    const EDITABLE_STATUSES = ["em_analise_ia", "revisao_analista", "devolvido_analista"];
    const { data: companyGroupsForGate, error: gateErr } = await supabase
      .from("payment_company_groups")
      .select("company_name, status, confeccao_status")
      .eq("payment_id", payment_id);
    if (gateErr) throw gateErr;

    const targetCompanySet = new Set(companyNames.map((name) => name.toLowerCase()));
    const groupStateByName = new Map<string, { status: string; confeccao: string | null }>();
    for (const g of companyGroupsForGate ?? []) {
      const name = (g.company_name ?? "").trim() || "Sem empresa";
      groupStateByName.set(name.toLowerCase(), {
        status: g.status as string,
        confeccao: ((g as any).confeccao_status as string | null) ?? null,
      });
    }

    const skippedCompanies: Array<{ company_name: string; status: string }> = [];
    companyNames = companyNames.filter((name) => {
      const state = groupStateByName.get(name.toLowerCase());
      // Primeira análise (ou grupo ainda não consolidado): não há status de
      // workflow para proteger, então a empresa precisa ser processada.
      if (!state) return true;
      // Em confecção, o gate é o confeccao_status — não o status (que é placeholder).
      if (isConfeccao) {
        if (state.confeccao === "em_confeccao") return true;
        skippedCompanies.push({ company_name: name, status: state.confeccao ?? state.status });
        return false;
      }
      if (EDITABLE_STATUSES.includes(state.status)) return true;
      if (targetCompanySet.has(name.toLowerCase())) skippedCompanies.push({ company_name: name, status: state.status });
      return false;
    });
    const allowedLower = new Set(companyNames.map((s) => s.toLowerCase()));
    totalItems = (groups ?? [])
      .filter((g) => allowedLower.has(((g.company_name ?? "").trim() || "Sem empresa").toLowerCase()))
      .reduce((acc, g) => acc + (g.items_count || 0), 0);

    if (companyNames.length === 0) {
      const msg = skippedCompanies.length > 0
        ? "Nenhuma empresa disponível para análise — todas estão concluídas/em validação. Reabra alguma para reanalisar."
        : "nenhuma empresa para processar com os filtros aplicados";
      return new Response(JSON.stringify({
        ok: true,
        total_companies: 0,
        total_items: 0,
        message: msg,
        skipped_companies: skippedCompanies,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Guarda: não cria novo job se já existe um `em_andamento` para o mesmo
    // pagamento. Evita corrida entre dois jobs sobre os mesmos itens
    // (sintoma observado: ambos jobs ficam presos com processed < total).
    const { data: existingJobs } = await supabase
      .from("payment_processing_jobs")
      .select("id, processed_companies, total_companies, updated_at")
      .eq("payment_id", payment_id)
      .eq("status", "em_andamento")
      .limit(1);
    if (existingJobs && existingJobs.length > 0) {
      const ex = existingJobs[0];
      // [Fix delay regra→reanálise] Se o cliente pediu `force_fresh_rules` (vindo
      // de "Reaplicar regras" logo após editar uma regra), invalidamos o snapshot
      // de contexto do job em andamento. Sem isso, os workers restantes continuam
      // lendo o cache antigo e a regra recém-salva só vale na PRÓXIMA execução.
      // Os próximos workers vão cair em ctx_cache MISS e recarregar do banco.
      let rulesCacheCleared = false;
      if (force_fresh_rules === true) {
        try {
          const { error: delErr } = await supabase
            .from("payment_job_context")
            .delete()
            .eq("job_id", ex.id);
          if (delErr) {
            console.warn("[dispatch] falha ao limpar payment_job_context do job em andamento:", delErr.message);
          } else {
            rulesCacheCleared = true;
            console.log(`[dispatch] payment_job_context limpo para job ${ex.id} (force_fresh_rules=true em job em andamento)`);
          }
        } catch (e) {
          console.warn("[dispatch] erro ao invalidar snapshot de regras:", (e as any)?.message ?? e);
        }
      }
      return new Response(JSON.stringify({
        ok: true,
        already_running: true,
        job_id: ex.id,
        rules_cache_cleared: rulesCacheCleared,
        message: rulesCacheCleared
          ? `Análise em andamento (${ex.processed_companies}/${ex.total_companies}). Snapshot de regras invalidado — as próximas empresas vão usar as regras atualizadas.`
          : `Já existe uma análise em andamento (${ex.processed_companies}/${ex.total_companies}). Aguarde concluir ou aguarde o watchdog finalizá-la.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cria job de processamento
    const { data: job, error: jobErr } = await supabase
      .from("payment_processing_jobs")
      .insert({
        payment_id,
        // Escopo por hospital (invariante): job herda hospital do pagamento —
        // service_role não tem sessão de usuário, então precisa passar explícito.
        hospital_id: paymentHospitalId,
        total_companies: companyNames.length,
        processed_companies: 0,
        status: "em_andamento",
        company_list: companyNames,
        total_items: totalItems,
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    // 2026-06-24: zera flags de timeout/parcial-IA do RUN ANTERIOR antes que
    // as invocações por empresa comecem a fazer merge incremental em
    // `processing_diagnostics.per_company`. Sem este reset, um run novo
    // herdava o `processing_timeout_occurred=true` do run anterior mesmo
    // quando todas as empresas terminavam OK.
    try {
      await supabase.from("payments").update({
        processing_timeout_occurred: false,
        // [2026-08-07] Nova rodada de análise → libera o aviso `ia_concluded`
        // para ser enviado uma vez ao fim deste run.
        analysis_notified_at: null,
        processing_diagnostics: {
          status: "running",
          job_id: job.id,
          started_at: new Date().toISOString(),
          per_company: {},
          partial_ai_failure: false,
          has_company_error: false,
        },
      }).eq("id", payment_id);
    } catch (resetErr) {
      console.warn("[dispatch] falha ao resetar diagnósticos do pagamento:", (resetErr as any)?.message);
    }


    // Phase 2 lote misto: auto-classifica item_type_id por item ANTES do
    // orquestrador, para que o motor já calcule as regras com o tipo correto.
    // Mantém override manual e cruzamento de parecer (gates do edge).
    // 2026-07-01: encadeado em background (auto-classify → orchestrate) para
    // que o dispatch retorne <2s mesmo em lotes com 100+ empresas.
    //
    // 2026-07-31 [fix 502 na fila ai_retry_queue]: o encadeamento AGUARDAVA a
    // resposta completa do orquestrador. Como o orquestrador só responde depois
    // de processar a página inteira (até ~60s), a instância do dispatch ficava
    // viva além do limite de wall-clock e era derrubada pelo runtime — o cliente
    // (ai-retry-worker) recebia "502 Bad Gateway" mesmo com o job já criado e
    // rodando. Agora as chamadas encadeadas têm timeout curto: abortar o fetch
    // NÃO cancela a execução da function invocada, apenas libera esta instância.
    const orchestratorUrl = `${SUPABASE_URL}/functions/v1/orchestrate-analysis`;
    const AUTO_CLASSIFY_TIMEOUT_MS = 20_000;
    const ORCHESTRATOR_KICK_TIMEOUT_MS = 5_000;

    const postWithTimeout = async (url: string, payload: unknown, timeoutMs: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    runInBackground(
      (async () => {
        try {
          const acResp = await postWithTimeout(
            `${SUPABASE_URL}/functions/v1/auto-classify-payment-types`,
            { payment_id },
            AUTO_CLASSIFY_TIMEOUT_MS,
          );
          if (!acResp.ok) {
            console.warn("[dispatch] auto-classify falhou", acResp.status, (await acResp.text()).slice(0, 300));
          } else {
            const acJson = await acResp.json().catch(() => ({}));
            console.log(`[dispatch] auto-classify ok auto_tuss=${acJson?.auto_tuss} auto_heuristic=${acJson?.auto_heuristic} auto_default=${acJson?.auto_default}`);
          }
        } catch (acErr) {
          const name = (acErr as { name?: string })?.name;
          if (name === "AbortError") {
            console.warn(`[dispatch] auto-classify excedeu ${AUTO_CLASSIFY_TIMEOUT_MS}ms — segue para o orquestrador (execução continua no servidor)`);
          } else {
            console.warn("[dispatch] auto-classify erro:", (acErr as any)?.message ?? acErr);
          }
        }

        // "Kick" do orquestrador: não esperamos o processamento da página —
        // apenas garantimos que a invocação foi aceita. O encadeamento das
        // páginas seguintes é responsabilidade do próprio orquestrador.
        try {
          const resp = await postWithTimeout(
            orchestratorUrl,
            {
              job_id: job.id,
              payment_id,
              page_index: 0,
              page_size: PAGE_SIZE,
              ai_statuses,
              tolerance_pct,
              force_fresh_rules: force_fresh_rules === true,
              skip_ai: __skip_ai,
            },
            ORCHESTRATOR_KICK_TIMEOUT_MS,
          );
          if (!resp.ok) console.error("[dispatch] orquestrador retornou erro", resp.status, (await resp.text()).slice(0, 500));
          else await resp.text();
        } catch (orchErr) {
          const name = (orchErr as { name?: string })?.name;
          if (name === "AbortError") {
            console.log(`[dispatch] orquestrador iniciado (job ${job.id}) — conexão liberada após ${ORCHESTRATOR_KICK_TIMEOUT_MS}ms sem aguardar o fim da página`);
          } else {
            console.error("[dispatch] falha ao chamar orquestrador:", (orchErr as any)?.message ?? orchErr);
          }
        }
      })(),
      "auto-classify + orquestrador",
    );



    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        total_companies: companyNames.length,
        total_items: totalItems,
        status: "dispatched",
        message: `Análise iniciada para ${companyNames.length} empresa(s) e ${totalItems} itens.`,
        skipped_companies: skippedCompanies,
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("dispatch-payment-analysis error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});