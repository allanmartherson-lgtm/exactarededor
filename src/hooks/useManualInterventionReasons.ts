import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type InterventionAction = "manual" | "acatar" | "excluir" | "editar";
export type FinancialImpact = "economia" | "perda" | "neutro";

export type ManualInterventionReason = {
  id: string;
  code: string;
  label: string;
  category: "reclassificacao_clinica" | "aceite_financeiro" | "operacional";
  description: string | null;
  is_seed: boolean;
  is_active: boolean;
  sort_order: number;
  hospital_id: string | null;
  financial_impact: FinancialImpact;
  applies_to: InterventionAction[];
};

/**
 * Carrega motivos de intervenção ativos (seeds globais + cadastros locais do
 * hospital ativo). Filtra suffixos `_legado` do dropdown. Se `appliesTo` é
 * passado, devolve só os motivos cujo `applies_to` inclui essa ação.
 */
export function useManualInterventionReasons(opts?: {
  appliesTo?: InterventionAction;
}) {
  const [reasons, setReasons] = useState<ManualInterventionReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("manual_intervention_reasons")
      .select(
        "id,code,label,category,description,is_seed,is_active,sort_order,hospital_id,financial_impact,applies_to",
      )
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setReasons([]);
        } else {
          const rows = ((data ?? []) as ManualInterventionReason[]).filter(
            (r) => !r.code.endsWith("_legado"),
          );
          setReasons(rows);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!opts?.appliesTo) return reasons;
    const a = opts.appliesTo;
    return reasons.filter((r) => (r.applies_to ?? []).includes(a));
  }, [reasons, opts?.appliesTo]);

  const byCategory = {
    reclassificacao_clinica: filtered.filter(
      (r) => r.category === "reclassificacao_clinica",
    ),
    aceite_financeiro: filtered.filter(
      (r) => r.category === "aceite_financeiro",
    ),
    operacional: filtered.filter((r) => r.category === "operacional"),
  };

  return { reasons: filtered, byCategory, loading, error };
}
