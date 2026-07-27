// compute-company-financials
// Calcula a composição financeira (bruto, débitos, créditos, glosas, pool, conciliação, líquido)
// para um par (payment_id, company_id) e PERSISTE em payment_company_financials.
// Toda a lógica que antes vivia em useFinancialComposition.ts agora roda server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);
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
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await uc.auth.getUser();
      userId = user?.id ?? null;
    }

    // Detecta pool mode: itens são coletivos (is_pool_item=true, company_id=NULL).
    // O bruto da PJ deixa de ser "soma de itens da PJ" e passa a ser a fatia
    // proporcional do total do pool segundo o pool_participants.percentual.
    const { data: pmtRow } = await supabase
      .from("payments").select("pool_id, competence_month, competence_months, hospital_id").eq("id", payment_id).maybeSingle();
    const paymentHospitalId: string | null = (pmtRow as any)?.hospital_id ?? null;
    if (paymentHospitalId && !auth.is_internal && !assertCallerHospital(auth, paymentHospitalId)) {
      return new Response(JSON.stringify({
        error: "hospital_scope_denied",
        message: "Seu hospital ativo não corresponde ao hospital deste registro.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const poolId = (pmtRow as any)?.pool_id ?? null;
    const competenceDate: string | null = (pmtRow as any)?.competence_month
      ? String((pmtRow as any).competence_month).slice(0, 7) + "-01"
      : Array.isArray((pmtRow as any)?.competence_months) && (pmtRow as any).competence_months[0]
        ? String((pmtRow as any).competence_months[0]).slice(0, 7) + "-01"
        : null;

    const loadPoolDeductions = async (pid: string, pct: number) => {
      const { data: deds } = await supabase
        .from("pool_deductions").select("id, tipo, descricao, valor, valor_variavel").eq("pool_id", pid);
      const out: Array<{ tipo: string; descricao: string; valor: number; valor_total: number }> = [];
      for (const d of (deds ?? []) as any[]) {
        let total = Number(d.valor || 0);
        let descricao = d.descricao;
        if (d.valor_variavel && competenceDate) {
          const { data: pdv } = await supabase
            .from("pool_deduction_values")
            .select("valor, observacao")
            .eq("pool_deduction_id", d.id)
            .eq("competence_month", competenceDate)
            .maybeSingle();
          if (pdv) {
            total = Number((pdv as any).valor || 0);
            descricao = `${d.descricao}${(pdv as any).observacao ? ` — ${(pdv as any).observacao}` : ""}`;
          }
        }
        out.push({
          tipo: d.tipo,
          descricao,
          valor_total: round2(total),
          valor: round2(total * pct / 100),
        });
      }
      return out;
    };

    // Agregações pesadas (bruto/pool/débitos/créditos/glosas/conciliação) rodam
    // dentro do banco em uma única chamada — antes eram baixadas linha a linha
    // para o edge runtime, o que estourava o timeout em lotes grandes.
    const { data: aggRaw, error: aggErr } = await supabase
      .rpc("compute_company_financial_aggregates", {
        p_payment_id: payment_id,
        p_company_id: company_id,
      });
    if (aggErr) throw aggErr;
    const agg = (aggRaw ?? {}) as Record<string, any>;
    if (agg.ok === false) throw new Error(agg.error ?? "Falha ao agregar composição financeira");

    let bruto = 0;
    // Em pool soberano, calcula:
    //  - bruto      = pct × soma_gross dos itens do pool (fatia bruta da PJ)
    //  - poolShare  = bruto − quota (parte das deduções que cabe à PJ; vai para coluna `pool`)
    // Assim o card mostra: Bruto (fatia) / Descontos (deduções aplicadas) / Líquido (quota da run).
    let poolRunForBruto: any = null;
    let poolGrossShare = 0;
    let poolShareDeducoes = 0;
    if (poolId) {
      const totalPool = Number(agg.pool_total || 0);
      const companyMinimumComplement = Number(agg.minimum_complement || 0);
      const { data: parts } = await supabase
        .from("pool_participants").select("company_id, percentual").eq("pool_id", poolId);
      const minhaPart = (parts ?? []).find((p: any) => p.company_id === company_id);
      const pct = Number(minhaPart?.percentual ?? 0);
      poolGrossShare = round2(totalPool * pct / 100);
      bruto = round2(poolGrossShare + companyMinimumComplement);

      const { data: runRow } = await supabase
        .from("pool_calculation_runs")
        .select("id, base_amount, bolo_liquido, deductions_applied, quotas, snapshot, invalidated_at")
        .eq("payment_id", payment_id).eq("pool_id", poolId)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (runRow && !(runRow as any).invalidated_at) {
        poolRunForBruto = runRow;
        const quotas = (poolRunForBruto.quotas ?? []) as any[];
        const minhaQuota = quotas.find((q: any) => q.company_id === company_id);
        const quotaVal = Number(minhaQuota?.quota ?? 0);
        poolShareDeducoes = round2(poolGrossShare - quotaVal);
      }
    } else {
      // Bruto (soma de gross_amount dos itens da empresa neste pagamento).
      // Exclui itens cancelados (is_cancelled) e absorvidos em pacote (package_absorbed).
      bruto = round2(Number(agg.bruto_simple || 0));
    }


    // Débitos/Créditos e Glosas (já agregados no banco)
    const debitos = round2(Number(agg.debitos || 0));
    const creditos = round2(Number(agg.creditos || 0));
    const glosas = round2(Number(agg.glosas || 0));


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

    if (poolId) {
      // POOL SOBERANO: bruto = fatia gross da PJ; poolShareDeducoes vai para `pool`
      // (parte das deduções da run que cabe a esta PJ na proporção do percentual).
      poolAplicado = true;
      const { data: poolMeta } = await supabase
        .from("pools").select("id, nome, base_calculo").eq("id", poolId).maybeSingle();
      const { data: allParts } = await supabase
        .from("pool_participants").select("company_id, percentual").eq("pool_id", poolId);
      const minhaPart = (allParts ?? []).find((p: any) => p.company_id === company_id);
      const pct = Number(minhaPart?.percentual ?? 0);

      // Deduções para exibição: prioriza deductions_applied da run (tem valor real
      // da competência); fallback para pool_deductions.valor.
      let dedDisplay: Array<{ tipo: string; descricao: string; valor: number }> = [];
      if (poolRunForBruto?.deductions_applied) {
        const arr = Array.isArray(poolRunForBruto.deductions_applied) ? poolRunForBruto.deductions_applied : [];
        dedDisplay = arr.map((d: any) => ({
          tipo: d.tipo, descricao: d.descricao,
          valor: round2(Number(d.valor || 0) * pct / 100),
        }));
      } else {
        const fallbackDeds = await loadPoolDeductions(poolId, pct);
        dedDisplay = fallbackDeds.map(({ valor_total: _total, ...rest }) => rest);
        poolShareDeducoes = round2(fallbackDeds.reduce((s, d) => s + d.valor, 0));
      }
      // Aplica deduções já calculadas pela run (ou preview mensal quando ainda não há run).
      poolImpactoTotal += poolShareDeducoes;

      const baseRun = poolRunForBruto ? Number(poolRunForBruto.base_amount || 0) : poolGrossShare / (pct / 100 || 1);
      const boloRun = poolRunForBruto ? Number(poolRunForBruto.bolo_liquido || 0) : round2(baseRun - (poolShareDeducoes / (pct / 100 || 1)));
      detalhes.push({
        pool_id: poolId,
        pool_nome: (poolMeta as any)?.nome ?? "Pool",
        base: round2(baseRun),
        bolo: round2(boloRun),
        contribuicao_empresa: bruto,
        quota_empresa: round2(bruto - poolShareDeducoes),
        impacto: poolShareDeducoes,
        percentual: pct,
        deducoes: dedDisplay,
      });
    } else if (runs && runs.length > 0) {
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
        // Deduções cadastradas no pool (fixo mensal, plantão, etc.) — para exibição na UI.
        const dedDisplay = pool?.id ? await loadPoolDeductions(pool.id, Number(minha.percentual || 0)) : [];
        detalhes.push({
          pool_id: r.pool_id, pool_nome: pool?.nome ?? "Pool",
          base: Number(r.base_amount), bolo: Number(r.bolo_liquido),
          contribuicao_empresa: round2(contrib), quota_empresa: Number(minha.quota || 0),
          impacto, percentual: Number(minha.percentual || 0),
          deducoes: dedDisplay.map(({ valor_total: _total, ...rest }) => rest),
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

          const fallbackDeds = await loadPoolDeductions(pool.id, 100);
          const staticTypes = new Set(["fixo_mensal", "plantao", "valor_referencia_externa"]);
          const totalDed = fallbackDeds
            .filter((d: any) => staticTypes.has(d.tipo))
            .reduce((s: number, d: any) => s + Number(d.valor_total || 0), 0);
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
            deducoes: fallbackDeds.map(({ valor_total: _total, ...rest }) => ({ ...rest, valor: round2(rest.valor * pct / 100) })),
          });
        }
      }
    }

    // Conciliação (flag já agregada no banco)
    const conciliacaoAplicada = Boolean(agg.conciliacao_aplicada);
    const conciliacao = 0;


    const pool = round2(poolImpactoTotal);
    const liquido = round2(bruto - debitos + creditos - glosas - pool + conciliacao);

    // Persiste o snapshot via RPC para adquirir o mesmo advisory lock do fluxo
    // de acate/reanálise antes de tocar em payment_company_financials. Isso evita
    // ordem invertida de locks entre financials → groups/payments e items → triggers.
    const { data: upsertResult, error: upErr } = await supabase
      .rpc("upsert_payment_company_financials_snapshot", {
        p_payment_id: payment_id,
        p_company_id: company_id,
        p_bruto: bruto,
        p_debitos: round2(debitos),
        p_creditos: round2(creditos),
        p_glosas: glosas,
        p_pool: pool,
        p_pool_aplicado: poolAplicado,
        p_pool_preview: poolPreview,
        p_pool_detalhes: detalhes,
        p_conciliacao: conciliacao,
        p_conciliacao_aplicada: conciliacaoAplicada,
        p_liquido: liquido,
        p_computed_at: new Date().toISOString(),
        p_computed_by: userId,
      });

    if (upErr) throw upErr;
    if (!(upsertResult as { ok?: boolean } | null)?.ok) {
      throw new Error((upsertResult as { error?: string } | null)?.error ?? "Falha ao persistir composição financeira");
    }

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
