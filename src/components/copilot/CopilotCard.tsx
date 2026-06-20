import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

type CopilotTask =
  | "explain_rule"
  | "explain_item_status"
  | "explain_value"
  | "summarize_inconsistencies"
  | "suggest_duplicate"
  | "disambiguate_entity";

interface CopilotCardProps {
  task: CopilotTask;
  context: Record<string, unknown>;
  title?: string;
  triggerLabel?: string;
  /** se true, dispara IA assim que monta. Se false, espera o clique. */
  autoRun?: boolean;
  /** callback opcional com o resultado estruturado/textual */
  onResult?: (result: unknown) => void;
}

/**
 * Componente reutilizável do copiloto IA.
 * - Nunca executa ação no banco — só sugere/explica.
 * - Mostra origem (IA) explicitamente para o analista.
 */
export function CopilotCard({
  task,
  context,
  title = "Análise IA",
  triggerLabel = "Pedir análise",
  autoRun = false,
  onResult,
}: CopilotCardProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text?: string; json?: unknown } | null>(null);
  const [open, setOpen] = useState(true);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-copilot", {
        body: { task, context },
      });
      if (error) {
        if (error.message?.includes("429")) {
          toast({ title: "Limite atingido", description: "Tente novamente em alguns segundos.", variant: "destructive" });
        } else if (error.message?.includes("402")) {
          toast({ title: "Créditos esgotados", description: "Recarregue os créditos da workspace.", variant: "destructive" });
        } else {
          toast({ title: "Erro no copiloto", description: error.message, variant: "destructive" });
        }
        return;
      }
      const r = (data as { result?: { text?: string } & Record<string, unknown> })?.result;
      if (r && typeof r === "object" && "text" in r) {
        setResult({ text: r.text as string });
      } else {
        setResult({ json: r });
      }
      onResult?.(r);
    } finally {
      setLoading(false);
    }
  };

  // auto-run on mount
  useState(() => {
    if (autoRun && !result && !loading) run();
  });

  return (
    <Card className="border-purple-200 bg-purple-50/40 dark:border-purple-900 dark:bg-purple-950/20">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-medium">{title}</span>
            <Badge variant="outline" className="text-[10px] h-5">IA · sugestão</Badge>
          </div>
          {result && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} className="h-6 w-6 p-0">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {!result && !loading && (
          <Button variant="outline" size="sm" onClick={run} className="h-7 text-xs">
            <Sparkles className="h-3 w-3 mr-1" />
            {triggerLabel}
          </Button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Analisando…
          </div>
        )}

        {result && open && (
          <div className="text-sm text-foreground/90 prose prose-sm dark:prose-invert max-w-none">
            {result.text ? (
              <ReactMarkdown>{result.text}</ReactMarkdown>
            ) : (
              <pre className="text-xs bg-background/60 p-2 rounded">{JSON.stringify(result.json, null, 2)}</pre>
            )}
            <div className="text-[10px] text-muted-foreground mt-2 italic">
              Sugestão gerada por IA — confirme antes de aplicar.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
