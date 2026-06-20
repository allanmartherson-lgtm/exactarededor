import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Task =
  | "explain_rule"
  | "explain_item_status"
  | "explain_value"
  | "summarize_inconsistencies"
  | "suggest_duplicate"
  | "disambiguate_entity";

interface CopilotResult {
  text?: string;
  [k: string]: unknown;
}

/**
 * Hook genérico para invocar o copiloto IA via edge function `ai-copilot`.
 * Não decide nada — apenas devolve a sugestão/explicação para a UI mostrar.
 */
export function useCopilot() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: Task, context: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-copilot", {
        body: { task, context },
      });
      if (error) {
        setError(error.message);
        return null;
      }
      const r = (data as { result?: CopilotResult })?.result ?? null;
      setResult(r);
      return r;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setResult(null); setError(null); };

  return { run, loading, result, error, reset };
}
