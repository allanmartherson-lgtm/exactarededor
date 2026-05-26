import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FinancialComposition = {
  bruto: number;        // valor bruto da produção (soma dos itens da empresa no lote)
  debitos: number;      // soma de company_adjustment_applications (tipo=debito) status != revertido
  creditos: number;     // soma de company_adjustment_applications (tipo=credito) status != revertido
  glosas: number;       // soma de glosa_payment_applications status != revertido && != pending_manual_resolution
  pool: number;         // valor de pool aplicado a esta empresa neste payment (placeholder por enquanto)
  poolAplicado: boolean;
  conciliacao: number;  // ajuste de conciliação (positivo = a mais; negativo = a menos)
  conciliacaoAplicada: boolean;
  liquido: number;      // bruto - debitos + creditos - glosas - pool + conciliacao
  loading: boolean;
  refresh: () => Promise<void>;
};

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
  const [conciliacao, setConciliacao] = useState(0);
  const [conciliacaoAplicada, setConciliacaoAplicada] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!paymentId || !companyId) { setLoading(false); return; }
    setLoading(true);

    // Débitos / créditos da empresa
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
        .select("id, tipo")
        .in("id", ids);
      const tipoMap = new Map((adjs ?? []).map((a: any) => [a.id, a.tipo]));
      caa.forEach((x: any) => {
        const tipo = tipoMap.get(x.adjustment_id);
        const v = Number(x.valor_aplicado || 0);
        if (tipo === "credito") cre += v; else deb += v;
      });
    }

    // Glosas dos médicos da empresa
    const { data: gpa } = await supabase
      .from("glosa_payment_applications")
      .select("valor_aplicado, status")
      .eq("payment_id", paymentId)
      .eq("company_id", companyId)
      .neq("status", "revertido")
      .neq("status", "pending_manual_resolution");
    const glo = (gpa ?? []).reduce((s: number, x: any) => s + Number(x.valor_aplicado || 0), 0);

    // Pool: por enquanto, sinaliza se existe pool_calculation_runs confirmado para este payment
    // (rateio detalhado por empresa será integrado na próxima fatia)
    const { data: pcr } = await supabase
      .from("pool_calculation_runs")
      .select("id, status")
      .eq("payment_id", paymentId)
      .neq("status", "revertido")
      .limit(1);
    setPoolAplicado((pcr ?? []).length > 0);
    setPool(0); // valor por empresa virá quando a fatia de rateio for ligada aqui

    // Conciliação: existe run concluída? (impacto por empresa virá quando reconciliation_items
    // forem segmentadas por empresa — por ora apenas marca como aplicada)
    const { data: rr } = await supabase
      .from("reconciliation_runs")
      .select("id, status")
      .eq("payment_id", paymentId)
      .eq("status", "done")
      .limit(1);
    setConciliacaoAplicada((rr ?? []).length > 0);
    setConciliacao(0);

    setDebitos(deb);
    setCreditos(cre);
    setGlosas(glo);
    setLoading(false);
  }, [paymentId, companyId]);

  useEffect(() => { load(); }, [load]);

  const liquido = bruto - debitos + creditos - glosas - pool + conciliacao;

  return {
    bruto, debitos, creditos, glosas,
    pool, poolAplicado, conciliacao, conciliacaoAplicada,
    liquido, loading, refresh: load,
  };
}
