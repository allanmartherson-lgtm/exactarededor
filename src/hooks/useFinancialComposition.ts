import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PoolDeducaoDetail = {
  tipo: string;
  descricao: string | null;
  valor: number;
};

export type PoolPreviewDetail = {
  pool_id: string;
  pool_nome: string;
  base: number;
  bolo: number;
  contribuicao_empresa: number;
  quota_empresa: number;
  impacto: number;
  percentual: number;
  deducoes?: PoolDeducaoDetail[];
};

export type FinancialComposition = {
  bruto: number;
  debitos: number;
  creditos: number;
  glosas: number;
  pool: number;
  poolAplicado: boolean;
  poolPreview: boolean;
  poolDetalhes: PoolPreviewDetail[];
  conciliacao: number;
  conciliacaoAplicada: boolean;
  liquido: number;
  loading: boolean;
  computedAt: string | null;
  refresh: () => Promise<void>;
};

export function useFinancialComposition(
  paymentId: string | undefined,
  companyId: string | undefined,
  brutoFallback: number,
): FinancialComposition {
  const [state, setState] = useState({
    bruto: brutoFallback, debitos: 0, creditos: 0, glosas: 0,
    pool: 0, poolAplicado: false, poolPreview: false,
    poolDetalhes: [] as PoolPreviewDetail[],
    conciliacao: 0, conciliacaoAplicada: false,
    liquido: brutoFallback, computedAt: null as string | null,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!paymentId || !companyId) { setLoading(false); return; }
    setLoading(true);

    // Dispara cálculo server-side (persiste em payment_company_financials)
    await supabase.functions.invoke("compute-company-financials", {
      body: { payment_id: paymentId, company_id: companyId },
    });

    // Lê snapshot do banco — fonte da verdade
    const { data: snap } = await supabase
      .from("payment_company_financials")
      .select("*")
      .eq("payment_id", paymentId).eq("company_id", companyId)
      .maybeSingle();

    if (snap) {
      setState({
        bruto: Number(snap.bruto), debitos: Number(snap.debitos),
        creditos: Number(snap.creditos), glosas: Number(snap.glosas),
        pool: Number(snap.pool), poolAplicado: !!snap.pool_aplicado,
        poolPreview: !!snap.pool_preview,
        poolDetalhes: (snap.pool_detalhes ?? []) as PoolPreviewDetail[],
        conciliacao: Number(snap.conciliacao),
        conciliacaoAplicada: !!snap.conciliacao_aplicada,
        liquido: Number(snap.liquido),
        computedAt: snap.computed_at,
      });
    }
    setLoading(false);
  }, [paymentId, companyId]);

  useEffect(() => { load(); }, [load]);

  return { ...state, loading, refresh: load };
}
