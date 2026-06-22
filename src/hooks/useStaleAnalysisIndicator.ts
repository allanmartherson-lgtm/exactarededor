import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Detecta automaticamente quando regras, débitos/créditos ou glosas que
 * impactam o pagamento aberto na tela foram editados depois da última análise.
 *
 * Por que polling e não realtime?
 *   As tabelas `rules`, `rule_calculations`, `company_financial_adjustments`
 *   e `glosa_debts` não estão na publicação `supabase_realtime`. Polling leve
 *   (foco da janela + intervalo) cobre o caso de uso sem migration adicional
 *   e sem aumentar a superfície de realtime do projeto.
 *
 * Escopo intencionalmente restrito (escolha do usuário): observa apenas o
 * pagamento na tela. Outros lotes só são reanalisados quando abertos.
 */
export type StaleReason = "rules" | "adjustments" | "glosa";

export function useStaleAnalysisIndicator(params: {
  companyId: string | null | undefined;
  doctorIds: string[];
  enabled?: boolean;
  pollMs?: number;
}) {
  const { companyId, doctorIds, enabled = true, pollMs = 30_000 } = params;
  const [isStale, setIsStale] = useState(false);
  const [reasons, setReasons] = useState<StaleReason[]>([]);
  const sinceRef = useRef<string>(new Date().toISOString());

  const doctorKey = doctorIds.slice().sort().join(",");

  const markFresh = useCallback(() => {
    sinceRef.current = new Date().toISOString();
    setIsStale(false);
    setReasons([]);
  }, []);

  const check = useCallback(async () => {
    if (!enabled || !companyId) return;
    const since = sinceRef.current;
    const found = new Set<StaleReason>();

    // 1) Regras: empresa-alvo, médico-alvo (qualquer um dos médicos do lote)
    //    ou regras master/global sem target. Inclui INSERT (created_at).
    const ruleFilters: string[] = [
      `target_company_id.eq.${companyId}`,
    ];
    if (doctorIds.length > 0) {
      const list = doctorIds.join(",");
      ruleFilters.push(`target_doctor_id.in.(${list})`);
    }
    // Master/global: nenhum target específico
    ruleFilters.push(
      `and(target_company_id.is.null,target_doctor_id.is.null,scope.in.(master,global))`,
    );
    const { data: rulesData } = await supabase
      .from("rules")
      .select("id, updated_at, created_at")
      .or(ruleFilters.join(","))
      .or(`updated_at.gt.${since},created_at.gt.${since}`)
      .limit(1);
    if ((rulesData ?? []).length > 0) found.add("rules");

    // 2) Débitos/créditos da empresa
    const { data: adjData } = await supabase
      .from("company_financial_adjustments")
      .select("id, updated_at, created_at")
      .eq("company_id", companyId)
      .or(`updated_at.gt.${since},created_at.gt.${since}`)
      .limit(1);
    if ((adjData ?? []).length > 0) found.add("adjustments");

    // 3) Glosas da empresa
    const { data: glosaData } = await supabase
      .from("glosa_debts")
      .select("id, updated_at, created_at")
      .eq("company_id", companyId)
      .or(`updated_at.gt.${since},created_at.gt.${since}`)
      .limit(1);
    if ((glosaData ?? []).length > 0) found.add("glosa");

    if (found.size > 0) {
      setReasons(Array.from(found));
      setIsStale(true);
    }
  }, [companyId, doctorKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling + foco da janela
  useEffect(() => {
    if (!enabled || !companyId) return;
    let active = true;
    const tick = async () => { if (active) await check(); };
    const interval = window.setInterval(tick, pollMs);
    const onFocus = () => { void tick(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // primeira checagem após pequeno delay
    const t0 = window.setTimeout(tick, 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearTimeout(t0);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [companyId, enabled, pollMs, check]);

  return { isStale, reasons, markFresh };
}
