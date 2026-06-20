import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CopilotCard } from "@/components/copilot/CopilotCard";

/**
 * Carrega a regra e cálculos vinculados, e oferece ao analista uma explicação IA
 * em linguagem natural ("o que essa regra faz, em quais casos se aplica").
 * Não decide nada — só explica.
 */
export function RuleExplainCard({ ruleId }: { ruleId: string }) {
  const [rule, setRule] = useState<Record<string, unknown> | null>(null);
  const [calcs, setCalcs] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [r, c] = await Promise.all([
        supabase.from("rules").select("*").eq("id", ruleId).maybeSingle(),
        supabase.from("rule_calculations").select("*").eq("rule_id", ruleId),
      ]);
      if (cancelled) return;
      setRule((r.data as Record<string, unknown>) ?? null);
      setCalcs((c.data as unknown[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ruleId]);

  if (loading || !rule) return null;

  return (
    <CopilotCard
      task="explain_rule"
      title="Explicar regra em linguagem natural"
      triggerLabel="Explicar com IA"
      context={{ rule: { ...rule, calculations: calcs } }}
    />
  );
}
