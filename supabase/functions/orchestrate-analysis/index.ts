// orchestrate-analysis
// Orquestrador paginado auto-encadeado. Cada chamada processa uma página
// de N empresas em paralelo, e dispara a próxima página fire-and-forget.
// Substitui a orquestração inline do dispatch-payment-analysis (que estourava
// timeout em lotes com 100+ empresas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      job_id,
      payment_id,
      page_index = 0,
      page_size = 8,
      ai_statuses,
      tolerance_pct,
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
      .select("company_list, total_companies, status")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      console.error("[orchestrate] job não encontrado", jobErr);
      return new Response(JSON.stringify({ error: "job não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    console.log(
      `[orchestrate] job=${job_id} página=${page_index} disparando ${companies.length} workers (${start}..${end - 1} de ${total})`,
    );

    // 4. Dispara workers em paralelo para esta página
    const workerUrl = `${SUPABASE_URL}/functions/v1/analyze-payment`;
    const invokeOne = async (companyName: string) => {
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
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          await supabase.rpc("increment_processing_progress", {
            _job_id: job_id,
            _company_name: companyName,
            _error: `HTTP ${resp.status}: ${txt.slice(0, 300)}`,
          });
        }
        // Sucesso: analyze-payment chama a RPC ao final.
      } catch (e: any) {
        await supabase.rpc("increment_processing_progress", {
          _job_id: job_id,
          _company_name: companyName,
          _error: String(e?.message ?? e).slice(0, 300),
        });
      }
    };

    await Promise.all(companies.map(invokeOne));

    // 5. Auto-encadeia próxima página (fire-and-forget) se ainda houver empresas
    const hasNext = end < total;
    if (hasNext) {
      const nextUrl = `${SUPABASE_URL}/functions/v1/orchestrate-analysis`;
      // Não aguardamos a resposta — cada página é uma execução independente
      // com seu próprio orçamento de 60s.
      fetch(nextUrl, {
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
        }),
      }).catch((e) => console.error("[orchestrate] falha ao disparar próxima página", e));
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
