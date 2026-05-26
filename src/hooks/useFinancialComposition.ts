import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PoolPreviewDetail = {
  pool_id: string;
  pool_nome: string;
  base: number;
  bolo: number;
  contribuicao_empresa: number;
  quota_empresa: number;
  impacto: number; // contribuicao - quota (positivo = empresa cede ao pool)
  percentual: number;
};

export type FinancialComposition = {
  bruto: number;
  debitos: number;
  creditos: number;
  glosas: number;
  pool: number;              // soma dos impactos (positivo = a deduzir do líquido)
  poolAplicado: boolean;     // existe run confirmado
  poolPreview: boolean;      // não há run, mas há pool elegível (estimativa)
  poolDetalhes: PoolPreviewDetail[];
  conciliacao: number;
  conciliacaoAplicada: boolean;
  liquido: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function useFinancialComposition(
  paymentId: string | undefined,
  companyId: string | undefined,
  bruto: number,
): FinancialComposition {
  const [debitos, setDebitos] = useState(0);
  const [creditos, setCreditos] = useState(0);
  const [glosas, setGlosas] = useState(0);
  const [pool, setPool] = useState(0);
  const [poolAplicado, setPoolAplicado] = useState(false);
  const [poolPreview, setPoolPreview] = useState(false);
  const [poolDetalhes, setPoolDetalhes] = useState<PoolPreviewDetail[]>([]);
  const [conciliacao, setConciliacao] = useState(0);
  const [conciliacaoAplicada, setConciliacaoAplicada] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!paymentId || !companyId) { setLoading(false); return; }
    setLoading(true);

    // Débitos / créditos
    const { data: caa } = await supabase
      .from("company_adjustment_applications")
      .select("valor_aplicado, adjustment_id, status")
      .eq("payment_id", paymentId)
      .eq("company_id", companyId)
      .neq("status", "revertido");
    let deb = 0, cre = 0;
    if (caa && caa.length > 0) {
      const ids = Array.from(new Set(caa.map((x: any) => x.adjustment_id)));
      const { data: adjs } = await supabase
        .from("company_financial_adjustments")
        .select("id, tipo").in("id", ids);
      const tipoMap = new Map((adjs ?? []).map((a: any) => [a.id, a.tipo]));
      caa.forEach((x: any) => {
        const v = Number(x.valor_aplicado || 0);
        if (tipoMap.get(x.adjustment_id) === "credito") cre += v; else deb += v;
      });
    }

    // Glosas
    const { data: gpa } = await supabase
      .from("glosa_payment_applications")
      .select("valor_aplicado, status")
      .eq("payment_id", paymentId).eq("company_id", companyId)
      .neq("status", "revertido").neq("status", "pending_manual_resolution");
    const glo = (gpa ?? []).reduce((s: number, x: any) => s + Number(x.valor_aplicado || 0), 0);

    // Pool — primeiro tenta run confirmado para este pagamento
    const today = new Date().toISOString().slice(0, 10);
    const { data: runs } = await supabase
      .from("pool_calculation_runs")
      .select("id, status, pool_id, base_amount, bolo_liquido, quotas, snapshot")
      .eq("payment_id", paymentId)
      .neq("status", "revertido");

    let poolImpactoTotal = 0;
    let poolPreviewFlag = false;
    let poolAplicadoFlag = false;
    const detalhes: PoolPreviewDetail[] = [];

    if (runs && runs.length > 0) {
      poolAplicadoFlag = true;
      // Para cada run, achar a quota desta empresa e a contribuição (precisa dos items)
      for (const r of runs as any[]) {
        const { data: pool } = await supabase
          .from("pools").select("id, nome, base_calculo").eq("id", r.pool_id).single();
        const quotas = (r.quotas ?? []) as any[];
        const minha = quotas.find(q => q.company_id === companyId);
        if (!minha) continue;
        // contribuição = sum dos items desta empresa no payment usando base do pool
        const baseField = pool?.base_calculo === "soma_expected" ? "expected_amount" : "gross_amount";
        const { data: meus } = await supabase
          .from("payment_items").select(baseField)
          .eq("payment_id", paymentId).eq("company_id", companyId);
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
      // Sem run: calcula preview a partir de pools elegíveis ativos
      const { data: minhasParts } = await supabase
        .from("pool_participants")
        .select("pool_id, percentual")
        .eq("company_id", companyId);
      const poolIds = Array.from(new Set((minhasParts ?? []).map((p: any) => p.pool_id)));
      if (poolIds.length > 0) {
        const { data: pools } = await supabase
          .from("pools").select("*").in("id", poolIds).eq("ativo", true);
        const ativos = (pools ?? []).filter((p: any) => {
          if (p.vigencia_inicio && p.vigencia_inicio > today) return false;
          if (p.vigencia_fim && p.vigencia_fim < today) return false;
          return true;
        });
        if (ativos.length > 0) poolPreviewFlag = true;
        for (const pool of ativos as any[]) {
          const { data: allParts } = await supabase
            .from("pool_participants").select("*").eq("pool_id", pool.id);
          const realParts = (allParts ?? []).filter((p: any) => p.participant_type === "company" && p.company_id);
          const realIds = realParts.map((p: any) => p.company_id);
          const baseField = pool.base_calculo === "soma_expected" ? "expected_amount" : "gross_amount";
          const { data: items } = await supabase
            .from("payment_items").select(`company_id, ${baseField}`)
            .eq("payment_id", paymentId).in("company_id", realIds);
          const base = (items ?? []).reduce((s: number, it: any) => s + Number(it[baseField] ?? 0), 0);
          const contribEmpresa = (items ?? [])
            .filter((it: any) => it.company_id === companyId)
            .reduce((s: number, it: any) => s + Number(it[baseField] ?? 0), 0);

          // Deduções estáticas (preview ignora dinâmicas que dependem de aplicação)
          const { data: deds } = await supabase
            .from("pool_deductions").select("*").eq("pool_id", pool.id);
          const staticTypes = new Set(["fixo_mensal", "plantao", "valor_referencia_externa"]);
          const totalDed = (deds ?? [])
            .filter((d: any) => staticTypes.has(d.tipo))
            .reduce((s: number, d: any) => s + Number(d.valor || 0), 0);
          const bolo = round2(base - totalDed);
          const minhaPart = realParts.find((p: any) => p.company_id === companyId);
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

    setPool(round2(poolImpactoTotal));
    setPoolAplicado(poolAplicadoFlag);
    setPoolPreview(poolPreviewFlag);
    setPoolDetalhes(detalhes);

    // Conciliação
    const { data: rr } = await supabase
      .from("reconciliation_runs")
      .select("id, status").eq("payment_id", paymentId).eq("status", "done").limit(1);
    setConciliacaoAplicada((rr ?? []).length > 0);
    setConciliacao(0);

    setDebitos(deb); setCreditos(cre); setGlosas(glo);
    setLoading(false);
  }, [paymentId, companyId]);

  useEffect(() => { load(); }, [load]);

  const liquido = bruto - debitos + creditos - glosas - pool + conciliacao;

  return {
    bruto, debitos, creditos, glosas,
    pool, poolAplicado, poolPreview, poolDetalhes,
    conciliacao, conciliacaoAplicada,
    liquido, loading, refresh: load,
  };
}
