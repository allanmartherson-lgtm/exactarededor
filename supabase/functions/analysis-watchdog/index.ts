// analysis-watchdog
// Cron a cada 2min. Detecta jobs `em_andamento` parados (sem update há >90s):
//  - Se ainda há páginas a despachar → re-dispara o orquestrador na próxima página.
//  - Se já não há mais páginas mas processed < total → workers morreram em
//    silêncio; finaliza como `parcial`, marcando empresas pendentes como falhas.
//  - Se idle > IDLE_FAIL_MINUTES → declara `parcial` como rede de segurança.
//  - Se um pagamento ficou `em_analise_ia` sem job, re-dispara o dispatcher.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUCK_SECONDS = 90;
const IDLE_FAIL_MINUTES = 30;
const PAGE_SIZE = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const cutoffStuck = new Date(Date.now() - STUCK_SECONDS * 1000).toISOString();

    const { data: jobs, error: jobsErr } = await supabase
      .from("payment_processing_jobs")
      .select("id, payment_id, status, processed_companies, total_companies, current_page, company_list, failed_companies, updated_at, started_at, created_at")
      .eq("status", "em_andamento")
      .lt("updated_at", cutoffStuck)
      .order("updated_at", { ascending: true })
      .limit(20);

    if (jobsErr) throw jobsErr;

    const actions: Array<Record<string, unknown>> = [];

    for (const job of (jobs ?? [])) {
      // [Hardening 2026-06-12] Antes de qualquer decisão, reconcilia o
      // contador `processed_companies` a partir do estado real dos grupos
      // (payment_company_groups). Resolve o "phantom 156/159" — quando o
      // orchestrator/worker foi morto pelo runtime sem chamar
      // increment_processing_progress, mas as empresas FORAM analisadas.
      try {
        const { data: reconciled } = await supabase.rpc("reconcile_job_progress", { _job_id: job.id });
        if (reconciled && typeof reconciled === "object") {
          job.processed_companies = (reconciled as Record<string, unknown>).processed_companies as number;
          job.status = (reconciled as Record<string, unknown>).status as string;
          job.updated_at = (reconciled as Record<string, unknown>).updated_at as string;
        }
        if (job.status === "concluido" || job.status === "parcial" || job.status === "cancelado") {
          actions.push({ job_id: job.id, action: "reconciled_to_terminal", new_status: job.status });
          continue;
        }
      } catch (e) {
        console.error("[analysis-watchdog] reconcile_job_progress falhou", e);
      }

      const ageMs = Date.now() - new Date(job.updated_at as string).getTime();
      const ageMin = ageMs / 60_000;
      const companyList: string[] = Array.isArray(job.company_list) ? (job.company_list as string[]) : [];
      const total = companyList.length;
      const nextPage = ((job.current_page as number) ?? -1) + 1;
      const startIdx = nextPage * PAGE_SIZE;
      const processed = (job.processed_companies as number) ?? 0;
      const totalExpected = (job.total_companies as number) ?? total;
      const outOfPages = startIdx >= total;

      // CASO A: fim das páginas, mas progresso incompleto → finaliza parcial
      if (outOfPages && processed < totalExpected) {
        const { data: groups } = await supabase
          .from("payment_company_groups")
          .select("company_name, status")
          .eq("payment_id", job.payment_id);
        const seen = new Map<string, string>();
        for (const g of groups ?? []) seen.set(((g.company_name ?? "") as string).toLowerCase(), g.status as string);
        const missing = companyList.filter((name) => {
          const s = seen.get(name.toLowerCase());
          return !s || s === "em_analise_ia";
        });

        const failedEntries = missing.map((name) => ({
          company_name: name,
          error: "worker nunca reportou (timeout/crash silencioso) — finalizado pelo watchdog",
          at: new Date().toISOString(),
        }));

        const merged = [...((job.failed_companies as any[]) ?? []), ...failedEntries];
        await supabase
          .from("payment_processing_jobs")
          .update({
            status: "parcial",
            processed_companies: totalExpected,
            failed_companies: merged,
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        try {
          await fetch(`${SUPABASE_URL}/functions/v1/recalc-payment-pools`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ payment_id: job.payment_id }),
          });
        } catch (_) { /* noop */ }

        actions.push({
          job_id: job.id,
          action: "finalized_parcial_out_of_pages",
          missing_count: missing.length,
          processed,
          total: totalExpected,
        });
        continue;
      }

      // CASO B: idle excessivo → encerra
      if (ageMin > IDLE_FAIL_MINUTES) {
        await supabase
          .from("payment_processing_jobs")
          .update({ status: "parcial", finished_at: new Date().toISOString() })
          .eq("id", job.id);
        actions.push({ job_id: job.id, action: "marked_parcial_idle", age_min: Math.round(ageMin) });
        continue;
      }

      // CASO C: stuck recuperável → re-dispara próxima página
      const orchestratorUrl = `${SUPABASE_URL}/functions/v1/orchestrate-analysis`;
      const resp = await fetch(orchestratorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          job_id: job.id,
          payment_id: job.payment_id,
          page_index: nextPage,
          page_size: PAGE_SIZE,
          _watchdog: true,
        }),
      });

      actions.push({
        job_id: job.id,
        action: "re_dispatched",
        page_index: nextPage,
        http_status: resp.status,
        age_seconds: Math.round(ageMs / 1000),
      });
    }

    // CASO D: pagamento preso em `em_analise_ia` sem job criado.
    // É o cenário mais perigoso: visualmente parece rodando, mas não existe
    // `payment_processing_jobs` para o watchdog acompanhar. Pode acontecer se
    // o navegador cair depois de criar o pagamento/itens e antes de chamar o
    // dispatcher, ou se a chamada client-side for abortada silenciosamente.
    const { data: stuckPayments, error: stuckErr } = await supabase
      .from("payments")
      .select("id, reference, updated_at, processing_diagnostics")
      .eq("status", "em_analise_ia")
      .lt("updated_at", cutoffStuck)
      .order("updated_at", { ascending: true })
      .limit(20);

    if (stuckErr) throw stuckErr;

    for (const payment of stuckPayments ?? []) {
      const { data: latestJobs } = await supabase
        .from("payment_processing_jobs")
        .select("id, status, processed_companies, total_companies, created_at")
        .eq("payment_id", payment.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const latestJob = latestJobs?.[0];
      if (latestJob?.status === "em_andamento") continue;

      if (latestJob && ["concluido", "parcial", "cancelado"].includes(latestJob.status as string)) {
        try {
          await supabase.rpc("recompute_payment_status_from_groups", { _payment_id: payment.id });
          actions.push({ payment_id: payment.id, action: "recomputed_stuck_payment", latest_job_status: latestJob.status });
          continue;
        } catch (e) {
          console.error("[analysis-watchdog] recompute de pagamento sem job ativo falhou", e);
        }
      }

      const prevDiag = (payment.processing_diagnostics ?? {}) as Record<string, unknown>;
      await supabase
        .from("payments")
        .update({
          processing_diagnostics: {
            ...prevDiag,
            watchdog_orphan_analysis: {
              last_attempt_at: new Date().toISOString(),
              reason: "em_analise_ia_sem_job_ativo",
            },
          },
        })
        .eq("id", payment.id);

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-payment-analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ payment_id: payment.id, _watchdog_orphan: true }),
      });

      actions.push({
        payment_id: payment.id,
        action: "dispatched_orphan_payment",
        latest_job_status: latestJob?.status ?? "sem_job",
        http_status: resp.status,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, jobs_inspected: jobs?.length ?? 0, actions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[analysis-watchdog] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
