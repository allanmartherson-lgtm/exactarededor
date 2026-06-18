import { useEffect, useState, useCallback, useRef } from "react";
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
  /** True quando snapshot ainda não existe (após reanálise, antes do compute). */
  snapshotMissing: boolean;
  /** Última falha conhecida ao tentar computar/ler snapshot. */
  error: string | null;
  refresh: () => Promise<void>;
};

const emptyState = (brutoFallback: number) => ({
  bruto: brutoFallback,
  debitos: 0,
  creditos: 0,
  glosas: 0,
  pool: 0,
  poolAplicado: false,
  poolPreview: false,
  poolDetalhes: [] as PoolPreviewDetail[],
  conciliacao: 0,
  conciliacaoAplicada: false,
  liquido: brutoFallback,
  computedAt: null as string | null,
  snapshotMissing: true,
  error: null as string | null,
});

export function useFinancialComposition(
  paymentId: string | undefined,
  companyId: string | undefined,
  brutoFallback: number,
): FinancialComposition {
  const [state, setState] = useState(() => emptyState(brutoFallback));
  const [loading, setLoading] = useState(true);
  const lastSnapshotRef = useRef(false);

  // Sincroniza fallback quando snapshot ainda não chegou — evita ficar travado
  // em R$ 0,00 caso compute-company-financials falhe ou demore.
  useEffect(() => {
    setState((prev) => {
      if (lastSnapshotRef.current) return prev; // snapshot real já carregado
      if (prev.bruto === brutoFallback && prev.liquido === brutoFallback) return prev;
      return { ...prev, bruto: brutoFallback, liquido: brutoFallback };
    });
  }, [brutoFallback]);

  const load = useCallback(async () => {
    if (!paymentId || !companyId) { setLoading(false); return; }
    setLoading(true);

    let computeError: string | null = null;
    try {
      // Dispara cálculo server-side (persiste em payment_company_financials)
      const { error } = await supabase.functions.invoke("compute-company-financials", {
        body: { payment_id: paymentId, company_id: companyId },
      });
      if (error) computeError = error.message ?? String(error);
    } catch (e: any) {
      computeError = e?.message ?? String(e);
    }

    // Lê snapshot do banco — fonte da verdade
    const { data: snap, error: snapErr } = await supabase
      .from("payment_company_financials")
      .select("*")
      .eq("payment_id", paymentId).eq("company_id", companyId)
      .maybeSingle();

    if (snap && snap.computed_at) {
      lastSnapshotRef.current = true;
      setState({
        bruto: Number(snap.bruto),
        debitos: Number(snap.debitos),
        creditos: Number(snap.creditos),
        glosas: Number(snap.glosas),
        pool: Number(snap.pool),
        poolAplicado: !!snap.pool_aplicado,
        poolPreview: !!snap.pool_preview,
        poolDetalhes: (snap.pool_detalhes ?? []) as PoolPreviewDetail[],
        conciliacao: Number(snap.conciliacao),
        conciliacaoAplicada: !!snap.conciliacao_aplicada,
        liquido: Number(snap.liquido),
        computedAt: snap.computed_at,
        snapshotMissing: false,
        error: computeError,
      });
    } else {
      // Sem snapshot (ou invalidado): mantém fallback visível mas sinaliza missing.
      lastSnapshotRef.current = false;
      setState({
        ...emptyState(brutoFallback),
        error: computeError ?? snapErr?.message ?? null,
      });
      if (computeError || snapErr) {
        console.warn("[useFinancialComposition] snapshot indisponível", {
          paymentId, companyId, computeError, snapErr,
        });
      }
    }
    setLoading(false);
  }, [paymentId, companyId, brutoFallback]);

  useEffect(() => { load(); }, [load]);

  return { ...state, loading, refresh: load };
}
