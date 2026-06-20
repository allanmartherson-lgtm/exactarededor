import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna true quando existe pelo menos 1 regra ATIVA com special_case_filter
 * relevante para o contexto atual.
 *
 * - Sem `companyId`: regra escopada ao hospital do pagamento (uso legado em PaymentDetail).
 * - Com `companyId`: além do hospital, a regra precisa estar realmente vinculada
 *   à PJ que está sendo analisada — via `target_company_id` igual a essa PJ,
 *   ou via `target_doctor_id` de um médico que tem itens dessa PJ no pagamento,
 *   ou via regra global (sem target). Sem isso, o banner aparecia para qualquer
 *   PJ desde que houvesse alguma regra de caso especial no hospital, mesmo que
 *   nenhuma se aplicasse à PJ em questão.
 */
export function useHasSpecialCaseRules(
  paymentId: string | null | undefined,
  companyId?: string | null,
) {
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
      const hospitalId = (pay as { hospital_id?: string | null } | null)?.hospital_id ?? null;

      // Modo legado: filtra só por hospital.
      if (!companyId) {
        let q = supabase
          .from("rules")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .not("special_case_filter", "is", null);
        if (hospitalId) q = q.eq("hospital_id", hospitalId);
        const { count } = await q;
        if (!cancelled) setHasRules((count ?? 0) > 0);
        return;
      }

      // Modo escopado por PJ: descobre médicos com itens dessa PJ no pagamento
      // para casar com regras `target_doctor_id`.
      const { data: items } = await supabase
        .from("payment_items")
        .select("doctor_id")
        .eq("payment_id", paymentId)
        .eq("company_id", companyId)
        .not("doctor_id", "is", null);

      const doctorIds = Array.from(
        new Set(
          ((items ?? []) as Array<{ doctor_id: string | null }>)
            .map((r) => r.doctor_id)
            .filter((d): d is string => !!d),
        ),
      );

      // Monta filtro: target_company_id = PJ
      //              OU target_doctor_id IN (médicos desta PJ)
      // Regras "globais" (sem target) NÃO contam — analistas reportaram banner
      // aparecendo em PJs sem vínculo real com a regra cadastrada.
      const orParts: string[] = [
        `target_company_id.eq.${companyId}`,
      ];
      if (doctorIds.length > 0) {
        orParts.push(`target_doctor_id.in.(${doctorIds.join(",")})`);
      } else {
        // Sem médicos elegíveis e sem target_company match possível → não há regra escopada.
        if (!cancelled) setHasRules(false);
        return;
      }

      let q = supabase
        .from("rules")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .not("special_case_filter", "is", null)
        .or(orParts.join(","));
      if (hospitalId) q = q.eq("hospital_id", hospitalId);

      const { count } = await q;
      if (!cancelled) setHasRules((count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [paymentId, companyId]);

  return hasRules;
}
