import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna true quando existe pelo menos 1 regra ATIVA cujo cálculo tem
 * `special_case_filter` preenchido e que é relevante para o contexto atual.
 *
 * Após a unificação (jun/2026) o filtro de caso especial vive APENAS no nível
 * do cálculo (`rule_calculations.special_case_filter`). A coluna equivalente
 * em `rules` foi descontinuada e não é mais lida.
 *
 * - Sem `companyId`: regras escopadas ao hospital do pagamento (uso legado em PaymentDetail).
 * - Com `companyId`: além do hospital, a regra precisa estar vinculada à PJ
 *   (via `target_company_id` igual a essa PJ, ou via `target_doctor_id` de um
 *   médico que tem itens dessa PJ no pagamento). Regras globais (sem target)
 *   NÃO contam — analistas reportaram banner aparecendo em PJs sem vínculo real.
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

      // 1) Coleta IDs de regras que têm pelo menos 1 cálculo com special_case_filter preenchido.
      const { data: calcs } = await supabase
        .from("rule_calculations")
        .select("rule_id")
        .not("special_case_filter", "is", null);
      const ruleIdsWithSpecialCalc = Array.from(
        new Set(
          ((calcs ?? []) as Array<{ rule_id: string | null }>)
            .map((c) => c.rule_id)
            .filter((id): id is string => !!id),
        ),
      );
      if (ruleIdsWithSpecialCalc.length === 0) {
        if (!cancelled) setHasRules(false);
        return;
      }

      // Modo escopado por pagamento (sem PJ específica): coleta TODAS as PJs e
      // médicos com itens nesse pagamento e exige que pelo menos uma regra
      // com special_case_filter aponte para algum desses targets. Regras
      // globais (sem target) NÃO contam — analistas reportaram banner
      // aparecendo em lotes cuja empresa não tem nenhuma regra de caso
      // especial cadastrada.
      if (!companyId) {
        const { data: items } = await supabase
          .from("payment_items")
          .select("company_id, doctor_id")
          .eq("payment_id", paymentId);
        const companyIds = Array.from(new Set(
          ((items ?? []) as Array<{ company_id: string | null }>)
            .map((r) => r.company_id)
            .filter((c): c is string => !!c),
        ));
        const doctorIds = Array.from(new Set(
          ((items ?? []) as Array<{ doctor_id: string | null }>)
            .map((r) => r.doctor_id)
            .filter((d): d is string => !!d),
        ));
        const orParts: string[] = [];
        if (companyIds.length > 0) orParts.push(`target_company_id.in.(${companyIds.join(",")})`);
        if (doctorIds.length > 0) orParts.push(`target_doctor_id.in.(${doctorIds.join(",")})`);
        if (orParts.length === 0) { if (!cancelled) setHasRules(false); return; }

        let q = supabase
          .from("rules")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .in("id", ruleIdsWithSpecialCalc)
          .or(orParts.join(","));
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

      const orParts: string[] = [
        `target_company_id.eq.${companyId}`,
      ];
      if (doctorIds.length > 0) {
        orParts.push(`target_doctor_id.in.(${doctorIds.join(",")})`);
      } else {
        if (!cancelled) setHasRules(false);
        return;
      }

      let q = supabase
        .from("rules")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .in("id", ruleIdsWithSpecialCalc)
        .or(orParts.join(","));
      if (hospitalId) q = q.eq("hospital_id", hospitalId);

      const { count } = await q;
      if (!cancelled) setHasRules((count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [paymentId, companyId]);

  return hasRules;
}
