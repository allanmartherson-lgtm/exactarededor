// orchestrate-analysis
// Orquestrador paginado auto-encadeado. Cada chamada processa uma página
// de N empresas em paralelo, e dispara a próxima página fire-and-forget.
// Substitui a orquestração inline do dispatch-payment-analysis (que estourava
// timeout em lotes com 100+ empresas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const runInBackground = (promise: Promise<unknown>, label: string) => {
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const guarded = promise.catch((e) => console.error(`[orchestrate] ${label}`, e));
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(guarded);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {

    const body = await req.json();
    const {
      job_id,
      payment_id,
      page_index = 0,
      page_size = 4,
      ai_statuses,
      tolerance_pct,
      force_fresh_rules = false,
      skip_ai = false,
    } = body ?? {};

    if (!job_id || !payment_id) {
      return new Response(JSON.stringify({ error: "job_id e payment_id obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Lê estado atual do job
    const { data: job, error: jobErr } = await supabase
      .from("payment_processing_jobs")
      .select("company_list, total_companies, status, hospital_id")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      console.error("[orchestrate] job não encontrado", jobErr);
      return new Response(JSON.stringify({ error: "job não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!auth.is_internal && !assertCallerHospital(auth, (job as any)?.hospital_id ?? null)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Cancelado/concluído → não faz nada
    if (job.status === "cancelado" || job.status === "concluido" || job.status === "parcial") {
      console.log(`[orchestrate] job ${job_id} já está em estado terminal (${job.status}) — skip`);
      return new Response(JSON.stringify({ skipped: true, status: job.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2.1 Guarda de idempotência: claim atômico da página.
    // Só prossegue se conseguir avançar current_page para o page_index recebido.
    // Se outra execução já reivindicou esta página (ou superior), aborta sem disparar workers.
    const { data: claimed, error: claimErr } = await supabase
      .from("payment_processing_jobs")
      .update({ current_page: page_index })
      .eq("id", job_id)
      .lt("current_page", page_index)
      .select("id");

    if (claimErr) {
      console.error("[orchestrate] erro no claim de página", claimErr);
      return new Response(JSON.stringify({ error: "claim_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!claimed || claimed.length === 0) {
      console.log(`[orchestrate] página ${page_index} do job ${job_id} já foi reivindicada — skip`);
      return new Response(
        JSON.stringify({ skipped: true, reason: "page_already_processed", page_index }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const companyList: string[] = Array.isArray(job.company_list) ? job.company_list : [];
    const total = companyList.length;

    // 3. Calcula janela da página
    const start = page_index * page_size;
    const end = Math.min(start + page_size, total);
    const companies = companyList.slice(start, end);

    if (companies.length === 0) {
      // Sem empresas nesta página — nada a fazer; o status final será derivado
      // por increment_processing_progress quando processed_companies == total.
      console.log(`[orchestrate] página ${page_index} vazia (start=${start}, total=${total})`);
      return new Response(JSON.stringify({ done: true, total }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // [Sprint 5 - Dead-letter] Empresas com 3+ falhas consecutivas neste payment
    // são marcadas como 'active' em analysis_dead_letter e não devem ser redisparadas
    // até serem liberadas manualmente. Reduz custo e evita loop em empresas com
    // dados corrompidos. Para reanalisar, equipe libera pela UI (status='resolved').
    const { data: deadLetters } = await supabase
      .from("analysis_dead_letter")
      .select("company_name")
      .eq("payment_id", payment_id)
      .eq("status", "active")
      .in("company_name", companies);
    const deadSet = new Set<string>((deadLetters ?? []).map((d: { company_name: string }) => d.company_name));

    const liveCompanies = companies.filter((c) => !deadSet.has(c));
    if (deadSet.size > 0) {
      console.log(`[orchestrate] pulando ${deadSet.size} empresa(s) em dead-letter: ${[...deadSet].join(", ")}`);
      // Conta as puladas como falhas processadas para não travar o progresso do job.
      for (const dead of deadSet) {
        await supabase.rpc("increment_processing_progress", {
          _job_id: job_id,
          _company_name: dead,
          _error: "dead_letter: empresa pulada (3+ falhas consecutivas — liberar manualmente para reanalisar)",
        });
      }
    }

    console.log(
      `[orchestrate] job=${job_id} página=${page_index} disparando ${liveCompanies.length} workers (${start}..${end - 1} de ${total})`,
    );

    // 4. Dispara workers em paralelo para esta página
    const workerUrl = `${SUPABASE_URL}/functions/v1/analyze-payment`;
    const WORKER_FETCH_TIMEOUT_MS = 180_000; // [Sprint 1 - Tier 1.C] worker precisa de oxigênio enquanto regras não cacheadas (B) — antes 90s gerava falsas falhas em lotes densos
    const DEAD_LETTER_THRESHOLD = 3;

    // [Sprint 5] Registra falha no dead-letter (upsert + increment). Se atingir threshold,
    // marca como active para pular nas próximas execuções.
    const recordFailure = async (companyName: string, errorMsg: string) => {
      try {
        const { data: existing } = await supabase
          .from("analysis_dead_letter")
          .select("id, attempts, errors, status")
          .eq("payment_id", payment_id)
          .eq("company_name", companyName)
          .maybeSingle();

        const errorEntry = { at: new Date().toISOString(), job_id, error: errorMsg.slice(0, 500) };
        if (existing) {
          // Se já estava 'resolved' (foi liberada manualmente), reinicia contagem.
          const isReset = existing.status === "resolved";
          const newAttempts = isReset ? 1 : (existing.attempts ?? 0) + 1;
          const newErrors = isReset
            ? [errorEntry]
            : [...((existing.errors as unknown[]) ?? []).slice(-9), errorEntry];
          await supabase
            .from("analysis_dead_letter")
            .update({
              attempts: newAttempts,
              last_error: errorMsg.slice(0, 500),
              last_job_id: job_id,
              errors: newErrors,
              status: newAttempts >= DEAD_LETTER_THRESHOLD ? "active" : "resolved",
              resolved_at: isReset ? null : existing.status === "resolved" ? null : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          // [Multi-tenant] hospital_id é NOT NULL em analysis_dead_letter
          // e não há trigger que herde do payment — precisa ir explicitamente.
          const { error: dlInsErr } = await supabase
            .from("analysis_dead_letter")
            .insert({
              payment_id,
              hospital_id: job.hospital_id,
              company_name: companyName,
              attempts: 1,
              last_error: errorMsg.slice(0, 500),
              last_job_id: job_id,
              errors: [errorEntry],
              status: "resolved", // só vira 'active' ao atingir threshold
            });
          if (dlInsErr) console.error("[orchestrate] insert dead-letter falhou", dlInsErr);
        }
      } catch (e) {
        console.error("[orchestrate] falha ao registrar dead-letter", e);
      }

      // [Fila de retry automático] Enfileira para reprocessamento por worker.
      // RPC é idempotente (upsert por payment+company) e usa backoff exponencial.
      try {
        await supabase.rpc("enqueue_ai_retry", {
          p_payment_id: payment_id,
          p_company_name: companyName,
          p_hospital_id: (job as { hospital_id?: string }).hospital_id ?? null,
          p_error: errorMsg.slice(0, 1000),
          p_job_id: job_id,
          p_max_attempts: null,
        });
      } catch (e) {
        console.error("[orchestrate] falha ao enfileirar retry", e);
      }
    };

    const invokeOne = async (companyName: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            payment_id,
            company_name: companyName === "Sem empresa" ? null : companyName,
            ai_statuses,
            tolerance_pct,
            _job_id: job_id,
            _company_label: companyName,
            _force_fresh: force_fresh_rules === true,
            skip_ai: skip_ai === true,
            // 2026-06-26: worker roda em background (EdgeRuntime.waitUntil) e
            // responde 202 imediatamente. Elimina IDLE_TIMEOUT 504 em empresas
            // grandes — progresso continua sendo reportado via RPC.
            _async: true,
          }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          const txt = await resp.text();
          const errMsg = `HTTP ${resp.status}: ${txt.slice(0, 300)}`;
          await recordFailure(companyName, errMsg);
          await supabase.rpc("increment_processing_progress", {
            _job_id: job_id,
            _company_name: companyName,
            _error: errMsg,
          });
        }
        // Sucesso: analyze-payment chama a RPC ao final. (Não limpamos dead-letter
        // automaticamente — fica como histórico; liberação manual ajusta status.)
      } catch (e: any) {
        const msg = e?.name === "AbortError"
          ? `worker timeout após ${WORKER_FETCH_TIMEOUT_MS}ms (orquestrador prosseguiu para não travar o lote)`
          : String(e?.message ?? e);
        await recordFailure(companyName, msg);
        await supabase.rpc("increment_processing_progress", {
          _job_id: job_id,
          _company_name: companyName,
          _error: msg.slice(0, 300),
        });
      } finally {
        clearTimeout(timer);
      }
    };


    // 5. CRÍTICO: agenda próxima página ANTES de aguardar workers.
    // Garante continuidade da cadeia mesmo se algum worker travar ou se o
    // orquestrador for morto antes de Promise.all resolver. Cada página é
    // independente; workers reportam progresso por conta própria via RPC.
    const hasNext = end < total;
    if (hasNext) {
      const nextUrl = `${SUPABASE_URL}/functions/v1/orchestrate-analysis`;
      runInBackground(fetch(nextUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          job_id,
          payment_id,
          page_index: page_index + 1,
          page_size,
          ai_statuses,
          tolerance_pct,
          force_fresh_rules,
          skip_ai,
        }),
      }).then(async (resp) => {
        if (!resp.ok) console.error("[orchestrate] próxima página retornou erro", resp.status, (await resp.text()).slice(0, 500));
        else await resp.text();
      }), "falha ao disparar próxima página");
    }

    // 6. Aguarda workers desta página (com timeout individual). Falhas/timeouts
    // já são registrados em invokeOne via increment_processing_progress.
    // Pula empresas em dead-letter (já contabilizadas como falha acima).
    await Promise.all(liveCompanies.map(invokeOne));

    // 7. Se esta era a última página, dispara recálculo de pools (fire-and-forget).
    if (!hasNext) {
      // [Hardening 2026-06-12] Reconcilia o contador a partir do estado real
      // dos grupos antes de decidir se o lote está concluído. Cobre o caso de
      // workers terem terminado a análise mas terem sido mortos pelo runtime
      // antes de chamar increment_processing_progress.
      try {
        await supabase.rpc("reconcile_job_progress", { _job_id: job_id });
      } catch (e) {
        console.error("[orchestrate] reconcile_job_progress falhou", e);
      }
      const { data: finalJob } = await supabase
        .from("payment_processing_jobs")
        .select("status, processed_companies, total_companies")
        .eq("id", job_id)
        .single();
      const done = finalJob && (finalJob.status === "concluido" || finalJob.status === "parcial"
        || (finalJob.processed_companies ?? 0) >= (finalJob.total_companies ?? 0));
      if (done) {
        // [2026-08-07] Disparo ÚNICO do e-mail "Análise concluída".
        // Claim atômico: só envia quem conseguir marcar analysis_notified_at
        // (era NULL). Protege contra retries/concorrência da última página.
        try {
          const { data: claimedNotify, error: notifyClaimErr } = await supabase
            .from("payments")
            .update({ analysis_notified_at: new Date().toISOString() })
            .eq("id", payment_id)
            .is("analysis_notified_at", null)
            .select("id");
          if (notifyClaimErr) {
            console.error("[orchestrate] claim de notificação falhou", notifyClaimErr);
          } else if (claimedNotify && claimedNotify.length > 0) {
            const successCount = (finalJob?.processed_companies ?? 0)
              - ((finalJob as any)?.failed_companies?.length ?? 0);
            const failCount = (finalJob as any)?.failed_companies?.length ?? 0;
            runInBackground(fetch(`${SUPABASE_URL}/functions/v1/notify-analyst-event`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify({
                paymentId: payment_id,
                eventType: "ia_concluded",
                reason: `${successCount} sucesso(s), ${failCount} falha(s).`,
              }),
            }).then(async (resp) => {
              if (!resp.ok) console.error("[orchestrate] notify-analyst-event erro", resp.status, (await resp.text()).slice(0, 300));
              else await resp.text();
            }), "falha ao notificar ia_concluded");
          } else {
            console.log(`[orchestrate] ia_concluded já notificado para payment ${payment_id} — skip`);
          }
        } catch (e) {
          console.error("[orchestrate] erro ao notificar ia_concluded", e);
        }


        // [Pipeline único] Substituímos a colcha de retalhos (recalc-pools +
        // loops manuais por PJ) por uma chamada a `finalize-payment-engine`,
        // que garante leitura idempotente e auditável de TODAS as fontes:
        // company_adjustments, glosa_debts, minimum_guarantee, pool_deductions,
        // retroactive_reconciliation e special_case_marks. Cada fonte fica
        // registrada em payment_engine_sources com data/contagem/valor.
        const finalizeUrl = `${SUPABASE_URL}/functions/v1/finalize-payment-engine`;
        runInBackground(fetch(finalizeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ payment_id, force: true }),
        }).then(async (resp) => {
          if (!resp.ok) console.error("[orchestrate] finalize-payment-engine erro", resp.status, (await resp.text()).slice(0, 500));
          else console.log("[orchestrate] finalize-payment-engine concluído");
        }), "falha ao disparar finalize-payment-engine");

        // [Sprint 6 - Rule snapshot] Marca o cache de contexto como snapshot
        // permanente para auditoria/reprodutibilidade.
        runInBackground(
          supabase
            .from("payment_job_context")
            .update({ is_snapshot: true })
            .eq("job_id", job_id)
            .then(() => {}),
          "falha ao marcar payment_job_context como snapshot",
        );



        // Aprendizado: aplica hints de padrões aprendidos (validações aceitas)
        // aos itens deste pagamento. Soft — só gera badge na UI.
        runInBackground(
          supabase.rpc("apply_learned_hints_for_payment", { _payment_id: payment_id })
            .then(({ error, data }) => {
              if (error) console.error("[orchestrate] apply_learned_hints erro", error.message);
              else console.log("[orchestrate] learned hints aplicados:", data);
            }),
          "falha ao aplicar learned hints",
        );
      }
    }



    return new Response(
      JSON.stringify({
        ok: true,
        processed_page: page_index,
        companies_in_page: companies.length,
        has_next: hasNext,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[orchestrate] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
