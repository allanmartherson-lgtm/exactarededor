// analysis-watchdog
// Cron a cada 2min. Detecta jobs `em_andamento` parados (sem update há >90s):
//  - Se ainda há páginas a despachar → re-dispara o orquestrador na próxima página.
//  - Se já não há mais páginas mas processed < total → workers morreram em
//    silêncio; finaliza como `parcial`, marcando empresas pendentes como falhas.
//  - Se idle > IDLE_FAIL_MINUTES → declara `parcial` como rede de segurança.
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
