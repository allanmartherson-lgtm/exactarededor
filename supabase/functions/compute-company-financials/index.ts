// compute-company-financials
// Calcula a composição financeira (bruto, débitos, créditos, glosas, pool, conciliação, líquido)
// para um par (payment_id, company_id) e PERSISTE em payment_company_financials.
// Toda a lógica que antes vivia em useFinancialComposition.ts agora roda server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { payment_id, company_id } = await req.json();
    if (!payment_id || !company_id) {
      return new Response(JSON.stringify({ error: "payment_id e company_id obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let userId: string | null = null;
    const auth = req.headers.get("Authorization");
    if (auth) {
      const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await uc.auth.getUser();
      userId = user?.id ?? null;
    }

    // Bruto (soma de gross_amount dos itens da empresa neste pagamento)
    const { data: items } = await supabase
      .from("payment_items")
      .select("gross_amount")
      .eq("payment_id", payment_id).eq("company_id", company_id);
    const bruto = round2((items ?? []).reduce((s, it: any) => s + Number(it.gross_amount || 0), 0));

    // Débitos/Créditos
    const { data: caa } = await supabase
      .from("company_adjustment_applications")
      .select("valor_aplicado, adjustment_id, status")
      .eq("payment_id", payment_id).eq("company_id", company_id)
      .neq("status", "revertido");
    let debitos = 0, creditos = 0;
    if (caa && caa.length > 0) {
      const ids = Array.from(new Set(caa.map((x: any) => x.adjustment_id)));
      const { data: adjs } = await supabase
        .from("company_financial_adjustments").select("id, tipo").in("id", ids);
      const tipoMap = new Map((adjs ?? []).map((a: any) => [a.id, a.tipo]));
      caa.forEach((x: any) => {
        const v = Number(x.valor_aplicado || 0);
        if (tipoMap.get(x.adjustment_id) === "credito") creditos += v; else debitos += v;
      });
    }

    // Glosas
    const { data: gpa } = await supabase
      .from("glosa_payment_applications")
      .select("valor_aplicado, status")
      .eq("payment_id", payment_id).eq("company_id", company_id)
      .neq("status", "revertido").neq("status", "pending_manual_resolution");
    const glosas = round2((gpa ?? []).reduce((s, x: any) => s + Number(x.valor_aplicado || 0), 0));

    // Pool — runs confirmados ou preview
    const today = new Date().toISOString().slice(0, 10);
    const { data: runs } = await supabase
      .from("pool_calculation_runs")
      .select("id, status, pool_id, base_amount, bolo_liquido, quotas, snapshot")
      .eq("payment_id", payment_id).neq("status", "revertido");

    let poolImpactoTotal = 0;
    let poolPreview = false;
    let poolAplicado = false;
    const detalhes: any[] = [];

    if (runs && runs.length > 0) {
      poolAplicado = true;
      for (const r of runs as any[]) {
        const { data: pool } = await supabase
          .from("pools").select("id, nome, base_calculo").eq("id", r.pool_id).single();
        const quotas = (r.quotas ?? []) as any[];
        const minha = quotas.find((q: any) => q.company_id === company_id);
        if (!minha) continue;
        const baseField = pool?.base_calculo === "soma_expected" ? "expected_amount" : "gross_amount";
        const { data: meus } = await supabase
          .from("payment_items").select(baseField)
          .eq("payment_id", payment_id).eq("company_id", company_id);
        const contrib = (meus ?? []).reduce((s: number, it: any) => s + Number(it[baseField] ?? 0), 0);
        const impacto = round2(contrib - Number(minha.quota || 0));
        poolImpactoTotal += impacto;
        detalhes.push({
          pool_id: r.pool_id, pool_nome: pool?.nome ?? "Pool",
          base: Number(r.base_amount), bolo: Number(r.bolo_liquido),
          contribuicao_empresa: round2(contrib), quota_empresa: Number(minha.quota || 0),
          impacto, percentual: Number(minha.percentual || 0),
        });
      }
    } else {
      const { data: minhasParts } = await supabase
        .from("pool_participants").select("pool_id, percentual").eq("company_id", company_id);
      const poolIds = Array.from(new Set((minhasParts ?? []).map((p: any) => p.pool_id)));
      if (poolIds.length > 0) {
        const { data: pools } = await supabase
          .from("pools").select("*").in("id", poolIds).eq("ativo", true);
        const ativos = (pools ?? []).filter((p: any) => {
          if (p.vigencia_inicio && p.vigencia_inicio > today) return false;
          if (p.vigencia_fim && p.vigencia_fim < today) return false;
          return true;
        });
        if (ativos.length > 0) poolPreview = true;
        for (const pool of ativos as any[]) {
          const { data: allParts } = await supabase
            .from("pool_participants").select("*").eq("pool_id", pool.id);
          const realParts = (allParts ?? []).filter((p: any) => p.participant_type === "company" && p.company_id);
          const realIds = realParts.map((p: any) => p.company_id);
          const baseField = pool.base_calculo === "soma_expected" ? "expected_amount" : "gross_amount";
          const { data: items2 } = await supabase
            .from("payment_items").select(`company_id, ${baseField}`)
            .eq("payment_id", payment_id).in("company_id", realIds);
          const base = (items2 ?? []).reduce((s: number, it: any) => s + Number(it[baseField] ?? 0), 0);
          const contribEmpresa = (items2 ?? [])
            .filter((it: any) => it.company_id === company_id)
            .reduce((s: number, it: any) => s + Number(it[baseField] ?? 0), 0);

          const { data: deds } = await supabase
            .from("pool_deductions").select("*").eq("pool_id", pool.id);
          const staticTypes = new Set(["fixo_mensal", "plantao", "valor_referencia_externa"]);
          const totalDed = (deds ?? [])
            .filter((d: any) => staticTypes.has(d.tipo))
            .reduce((s: number, d: any) => s + Number(d.valor || 0), 0);
          const bolo = round2(base - totalDed);
          const minhaPart = realParts.find((p: any) => p.company_id === company_id);
          const pct = Number(minhaPart?.percentual || 0);
          const quota = round2(bolo * (pct / 100));
          const impacto = round2(contribEmpresa - quota);
          poolImpactoTotal += impacto;
          detalhes.push({
            pool_id: pool.id, pool_nome: pool.nome,
            base: round2(base), bolo,
            contribuicao_empresa: round2(contribEmpresa),
            quota_empresa: quota, impacto, percentual: pct,
          });
        }
      }
    }

    // Conciliação
    const { data: rr } = await supabase
      .from("reconciliation_runs")
      .select("id, status").eq("payment_id", payment_id).eq("status", "done").limit(1);
    const conciliacaoAplicada = (rr ?? []).length > 0;
    const conciliacao = 0;

    const pool = round2(poolImpactoTotal);
    const liquido = round2(bruto - debitos + creditos - glosas - pool + conciliacao);

    // UPSERT no snapshot
    const { error: upErr } = await supabase
      .from("payment_company_financials")
      .upsert({
        payment_id, company_id,
        bruto, debitos: round2(debitos), creditos: round2(creditos),
        glosas, pool, pool_aplicado: poolAplicado, pool_preview: poolPreview,
        pool_detalhes: detalhes,
        conciliacao, conciliacao_aplicada: conciliacaoAplicada,
        liquido, computed_at: new Date().toISOString(), computed_by: userId,
      }, { onConflict: "payment_id,company_id" });

    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true, bruto, debitos, creditos, glosas,
      pool, poolAplicado, poolPreview, poolDetalhes: detalhes,
      conciliacao, conciliacaoAplicada, liquido,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[compute-company-financials]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
