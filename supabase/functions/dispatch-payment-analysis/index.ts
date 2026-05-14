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

    // Buscamos a lista COMPLETA de empresas vinculadas ao lote a partir de payment_company_groups.
    // Isso evita o limite de 1000 linhas da tabela de itens e garante que todas as empresas sejam vistas.
    const { data: groups, error: groupsErr } = await supabase
      .from("payment_company_groups")
      .select("company_name, items_count")
      .eq("payment_id", payment_id);
    if (groupsErr) throw groupsErr;

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
    }

    if (companyNames.length === 0) {
      return new Response(JSON.stringify({ ok: true, total_companies: 0, total_items: 0, message: "nenhuma empresa para processar com os filtros aplicados" }), {
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
        company_list: companyNames,
        total_items: totalItems,
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
        total_items: totalItems,
        message: `Análise iniciada para ${companyNames.length} empresa(s) e ${totalItems} itens.`,
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