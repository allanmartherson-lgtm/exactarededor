// dispatch-payment-analysis
// Cria o job de processamento e delega a orquestração das empresas para
// `orchestrate-analysis`, que processa em páginas auto-encadeadas (cada
// página numa execução independente com seu próprio timeout de 60s).
// Esta função retorna em <2s: não orquestra workers diretamente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_SIZE = 4; // empresas processadas em paralelo por página do orquestrador (reduzido de 8 para mitigar contenção de lock em payments)

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

    // Buscamos a lista COMPLETA de empresas vinculadas ao lote. 
    // Tentamos primeiro por payment_company_groups (mais rápido).
    // Se estiver vazio (ex: após reimportação), buscamos direto nos itens.
    let { data: groups, error: groupsErr } = await supabase
      .from("payment_company_groups")
      .select("company_name, items_count")
      .eq("payment_id", payment_id);
    
    if (groupsErr) throw groupsErr;

    if (!groups || groups.length === 0) {
      console.log(`[dispatch] payment_company_groups vazio para ${payment_id}, buscando em payment_items...`);
      const { data: itemCompanies, error: itemsErr } = await supabase
        .from("payment_items")
        .select("company_name")
        .eq("payment_id", payment_id);
      
      if (itemsErr) throw itemsErr;
      
      const counts: Record<string, number> = {};
      for (const it of (itemCompanies ?? [])) {
        const name = (it.company_name ?? "").trim() || "Sem empresa";
        counts[name] = (counts[name] ?? 0) + 1;
      }
      
      groups = Object.entries(counts).map(([name, count]) => ({
        company_name: name,
        items_count: count
      }));
    }

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

    // Delega orquestração para `orchestrate-analysis` (página 0).
    // Fire-and-forget: dispatch retorna imediatamente sem aguardar.
    const orchestratorUrl = `${SUPABASE_URL}/functions/v1/orchestrate-analysis`;
    fetch(orchestratorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        job_id: job.id,
        payment_id,
        page_index: 0,
        page_size: PAGE_SIZE,
        ai_statuses,
        tolerance_pct,
      }),
    }).catch((e) => console.error("[dispatch] falha ao disparar orquestrador", e));

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        total_companies: companyNames.length,
        total_items: totalItems,
        status: "dispatched",
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