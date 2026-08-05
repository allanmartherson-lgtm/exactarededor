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
  /** Itens reprovados: compõem o bruto apresentado mas não são pagos. */
  reprovados: number;
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
  reprovados: 0,
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
  /**
   * Modo do pagamento:
   * - "analise" (default): roda compute-company-financials e lê snapshot.
   * - "confeccao": NÃO há gross_amount real; o bruto é Σ procedure_amount
   *   (valor convênio) e o líquido é Σ expected_amount (repasse calculado pelo
   *   motor). Débitos/glosas/pool ainda não se aplicam — só entram após
   *   finalizar a confecção e o lote ir para análise.
   */
  mode: "analise" | "confeccao" = "analise",
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

    // ---- Modo CONFECÇÃO: bypass da edge function ----
    // Em confecção gross_amount está nulo, então compute-company-financials
    // retornaria zeros sem sentido. Aqui calculamos diretamente:
    //   bruto    = Σ procedure_amount (valor convênio bruto da produção)
    //   liquido  = Σ expected_amount  (repasse calculado pelo motor)
    // Sem débitos/glosas/pool/conciliação — ainda não se aplicam nessa fase.
    if (mode === "confeccao") {
      try {
        const { data: rows, error } = await supabase
          .from("payment_items")
          .select("procedure_amount, expected_amount, is_cancelled, package_absorbed")
          .eq("payment_id", paymentId)
          .eq("company_id", companyId);
        if (error) throw error;
        const ativos = (rows ?? []).filter(
          (it: any) => !it.is_cancelled && !it.package_absorbed,
        );
        const bruto = ativos.reduce(
          (s: number, it: any) => s + Number(it.procedure_amount ?? 0),
          0,
        );
        const liquido = ativos.reduce(
          (s: number, it: any) => s + Number(it.expected_amount ?? 0),
          0,
        );
        lastSnapshotRef.current = true;
        setState({
          bruto: Math.round(bruto * 100) / 100,
          reprovados: 0,
          debitos: 0,
          creditos: 0,
          glosas: 0,
          pool: 0,
          poolAplicado: false,
          poolPreview: false,
          poolDetalhes: [],
          conciliacao: 0,
          conciliacaoAplicada: false,
          liquido: Math.round(liquido * 100) / 100,
          computedAt: new Date().toISOString(),
          snapshotMissing: false,
          error: null,
        });
      } catch (e: any) {
        lastSnapshotRef.current = false;
        setState({ ...emptyState(brutoFallback), error: e?.message ?? String(e) });
      }
      setLoading(false);
      return;
    }

    // ---- Modo ANÁLISE: caminho original via edge function ----
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
        reprovados: Number(snap.reprovados ?? 0),
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
  }, [paymentId, companyId, brutoFallback, mode]);

  useEffect(() => { load(); }, [load]);

  // Recarrega quando outro componente sinaliza que os financials deste
  // pagamento foram invalidados (ex.: pool recalculado). Garante que cards,
  // tabela e demais consumidores fiquem em sincronia sem refresh manual.
  useEffect(() => {
    if (!paymentId) return;
    const onInvalidated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { payment_id?: string } | undefined;
      if (!detail?.payment_id || detail.payment_id === paymentId) {
        void load();
      }
    };
    window.addEventListener("financials:invalidated", onInvalidated);
    return () => window.removeEventListener("financials:invalidated", onInvalidated);
  }, [paymentId, load]);

  return { ...state, loading, refresh: load };
}


