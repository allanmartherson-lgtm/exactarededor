import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ManualInterventionReason = {
  id: string;
  code: string;
  label: string;
  category: "reclassificacao_clinica" | "aceite_financeiro";
  description: string | null;
  is_seed: boolean;
  is_active: boolean;
  sort_order: number;
  hospital_id: string | null;
};

/**
 * Carrega motivos de intervenção manual ativos (seeds globais + cadastros
 * locais do hospital ativo). Não inclui os reasons "legacy" (sufixo
 * `_legado`), que existem só para preservar histórico migrado.
 */
export function useManualInterventionReasons() {
  const [reasons, setReasons] = useState<ManualInterventionReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("manual_intervention_reasons")
      .select(
        "id,code,label,category,description,is_seed,is_active,sort_order,hospital_id",
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

  const byCategory = {
    reclassificacao_clinica: reasons.filter(
      (r) => r.category === "reclassificacao_clinica",
    ),
    aceite_financeiro: reasons.filter(
      (r) => r.category === "aceite_financeiro",
    ),
  };

  return { reasons, byCategory, loading, error };
}
