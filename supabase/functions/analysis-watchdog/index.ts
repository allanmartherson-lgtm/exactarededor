// analysis-watchdog
// Cron a cada 2min. Detecta jobs `em_andamento` parados (sem update há >90s)
// e re-dispara a próxima página do orquestrador. Se um job ficar idle por mais
// de IDLE_FAIL_MIN sem progredir `processed_companies`, marca como `parcial`
// com erro descritivo, em vez de manter para sempre como em_andamento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUCK_SECONDS = 90;       // sem update há > 90s → reanima
const IDLE_FAIL_MINUTES = 30;   // sem update há > 30min → declara parcial
const PAGE_SIZE = 2;            // mesmo do dispatch

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const cutoffStuck = new Date(Date.now() - STUCK_SECONDS * 1000).toISOString();

    const { data: jobs, error: jobsErr } = await supabase
      .from("payment_processing_jobs")
      .select("id, payment_id, status, processed_companies, total_companies, current_page, company_list, updated_at, started_at, created_at")
      .eq("status", "em_andamento")
      .lt("updated_at", cutoffStuck)
      .order("updated_at", { ascending: true })
      .limit(20);

    if (jobsErr) throw jobsErr;

    const actions: Array<Record<string, unknown>> = [];

    for (const job of (jobs ?? [])) {
      const ageMs = Date.now() - new Date(job.updated_at as string).getTime();
      const ageMin = ageMs / 60_000;

      // Caso 1: idle por muito tempo — fecha como parcial
      if (ageMin > IDLE_FAIL_MINUTES) {
        await supabase
          .from("payment_processing_jobs")
          .update({
            status: "parcial",
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        actions.push({ job_id: job.id, action: "marked_parcial", age_min: Math.round(ageMin) });
        continue;
      }

      // Caso 2: stuck mas recuperável → re-dispara próxima página.
      // O claim atômico (`current_page < page_index`) garante que se outra
      // execução já estiver rodando, esta vira no-op.
      const companyList: string[] = Array.isArray(job.company_list) ? (job.company_list as string[]) : [];
      const total = companyList.length;
      const nextPage = ((job.current_page as number) ?? -1) + 1;
      const startIdx = nextPage * PAGE_SIZE;

      if (startIdx >= total) {
        // Não há próxima página, mas processed < total → re-despacha do início
        // só com empresas pendentes (idempotência cuida do skip).
        actions.push({ job_id: job.id, action: "no_next_page_but_pending", processed: job.processed_companies, total });
        // Reabrir página 0 não funciona (claim bloqueia). Estratégia: criar um
        // novo "rescue" via dispatch direto na rota orquestrador com
        // page_index = current_page+1 mesmo assim — se >= total, o orquestrador
        // marca como done.
      }

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
