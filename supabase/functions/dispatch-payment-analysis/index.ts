// dispatch-payment-analysis
// Lê todas as empresas distintas do lote e dispara analyze-payment em paralelo
// (uma invocação por empresa). Retorna 202 imediatamente; o cliente acompanha
// progresso via realtime na tabela payment_processing_jobs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 10; // invocações simultâneas

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { payment_id, ai_statuses, tolerance_pct, only_companies } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let companyNames: string[];
    if (Array.isArray(only_companies) && only_companies.length > 0) {
      companyNames = Array.from(new Set(only_companies.map((s: any) => String(s).trim() || "Sem empresa")));
    } else {
      // Distinct company_name no lote (inclui "Sem empresa" para itens sem company_name)
      const { data: rows, error: itemsErr } = await supabase
        .from("payment_items")
        .select("company_name")
        .eq("payment_id", payment_id);
      if (itemsErr) throw itemsErr;
      companyNames = Array.from(new Set(
        (rows ?? []).map((r: any) => (r.company_name ?? "").trim() || "Sem empresa")
      ));
    }

    if (companyNames.length === 0) {
      return new Response(JSON.stringify({ ok: true, total_companies: 0, message: "lote sem itens" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cria job de processamento
    const { data: job, error: jobErr } = await supabase
      .from("payment_processing_jobs")
      .insert({
        payment_id,
        total_companies: companyNames.length,
        processed_companies: 0,
        status: "em_andamento",
      })
      .select()
      .single();
    if (jobErr) throw jobErr;

    // Dispara workers em background. fire-and-forget: não aguardamos as respostas
    // para retornar rápido ao cliente. Cada worker reporta progresso via RPC.
    const dispatch = async () => {
      const invokeOne = async (companyName: string) => {
        try {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-payment`, {
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
              _job_id: job.id,
              _company_label: companyName,
            }),
          });
          if (!resp.ok) {
            const txt = await resp.text();
            // Reporta falha — analyze-payment não terá conseguido reportar.
            await supabase.rpc("increment_processing_progress", {
              _job_id: job.id,
              _company_name: companyName,
              _error: `HTTP ${resp.status}: ${txt.slice(0, 300)}`,
            });
          }
          // Sucesso: analyze-payment já chamou a RPC ao final.
        } catch (e: any) {
          await supabase.rpc("increment_processing_progress", {
            _job_id: job.id,
            _company_name: companyName,
            _error: String(e?.message ?? e).slice(0, 300),
          });
        }
      };

      // Chunks de CONCURRENCY paralelos
      for (let i = 0; i < companyNames.length; i += CONCURRENCY) {
        const slice = companyNames.slice(i, i + CONCURRENCY);
        await Promise.all(slice.map(invokeOne));
      }
    };

    // EdgeRuntime.waitUntil mantém o processo vivo para o fire-and-forget
    // @ts-ignore — disponível em Deno Deploy / Supabase Edge
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      (EdgeRuntime as any).waitUntil(dispatch());
    } else {
      // Fallback — dispara sem aguardar
      dispatch().catch((e) => console.error("dispatch error", e));
    }

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        total_companies: companyNames.length,
        message: `Análise iniciada para ${companyNames.length} empresa(s).`,
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
