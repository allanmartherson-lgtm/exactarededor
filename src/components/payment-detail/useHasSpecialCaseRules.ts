import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna true quando existe pelo menos 1 regra ATIVA do hospital do pagamento
 * com special_case_filter preenchido. Usado para "gate" o botão de marcar
 * caso especial — evita poluir a UI quando o hospital não usa o recurso.
 */
export function useHasSpecialCaseRules(paymentId: string | null | undefined) {
  const [hasRules, setHasRules] = useState<boolean | null>(null);

  useEffect(() => {
    if (!paymentId) { setHasRules(false); return; }
    let cancelled = false;
    (async () => {
      const { data: pay } = await supabase
        .from("payments")
        .select("hospital_id")
        .eq("id", paymentId)
        .maybeSingle();
      const hospitalId = (pay as any)?.hospital_id ?? null;
      let q = supabase
        .from("rules")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .not("special_case_filter", "is", null);
      if (hospitalId) q = q.eq("hospital_id", hospitalId);
      const { count } = await q;
      if (!cancelled) setHasRules((count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [paymentId]);

  return hasRules;
}
