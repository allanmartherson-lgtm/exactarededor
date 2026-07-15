// NOTA: O prompt de geração do resumo executivo é montado server-side em
// `supabase/functions/summarize-payment/index.ts` (constante `generalPrompt`).
// Ajustes nas INSTRUÇÕES PARA O RESUMO devem ser feitos lá. Foco: riscos
// FINANCEIROS (divergências, regras sem match, outliers). Concentração de
// médicos numa empresa NÃO é risco — em hospitais isso é normal.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { HighlightNarrative } from "./HighlightNarrative";

type RiskLevel = "baixo" | "medio" | "alto" | "critico";
interface ExecutiveSummary {
  headline: string;
  bullets: string[];
  risk_level: RiskLevel;
  recommended_action: string;
  generated_at: string;
}

interface Props {
  paymentId: string;
  payment: { processing_diagnostics?: unknown } | null;
}

const STALE_HOURS = 24;

const riskClasses: Record<RiskLevel, string> = {
  baixo: "bg-success-soft text-success border-success/30",
  medio: "bg-warning-soft text-warning border-warning/30",
  alto: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
  critico: "bg-destructive/10 text-destructive border-destructive/30",
};

const riskLabel: Record<RiskLevel, string> = {
  baixo: "Risco baixo",
  medio: "Risco médio",
  alto: "Risco alto",
  critico: "Risco crítico",
};

function isFresh(generatedAt: string | undefined): boolean {
  if (!generatedAt) return false;
  const diffMs = Date.now() - new Date(generatedAt).getTime();
  return diffMs < STALE_HOURS * 3600 * 1000;
}

export const ExecutiveSummaryCard = ({ paymentId, payment }: Props) => {
  const cached = (payment?.processing_diagnostics as Record<string, unknown> | undefined)?.executive_summary as
    | ExecutiveSummary
    | undefined;

  const [summary, setSummary] = useState<ExecutiveSummary | null>(
    cached && isFresh(cached.generated_at) ? cached : null,
  );
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const generate = useCallback(async (opts?: { silent?: boolean }) => {
    setLoading(true);
    const invokeOnce = async () => {
      const { data, error } = await supabase.functions.invoke("summarize-payment", {
        body: { payment_id: paymentId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    };
    try {
      let data;
      try {
        data = await invokeOnce();
      } catch (firstErr) {
        // 1 retry silencioso para erros de rede transitórios (FunctionsFetchError)
        await new Promise((r) => setTimeout(r, 800));
        data = await invokeOnce();
      }
      if (data?.summary) setSummary(data.summary);
    } catch (e) {
      if (!opts?.silent) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar resumo";
        toast({ title: "Resumo da análise", description: msg, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    if (!summary && !loading) {
      generate({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);


  const canToggle = !!summary && (summary.bullets?.length > 0 || !!summary.recommended_action);

  return (
    <Card className="shadow-card border-border/60 bg-card relative overflow-hidden">
      {/* Filete azul lateral — acento Apple discreto */}
      <div aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary/70" />
      <CardContent className="p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => canToggle && setExpanded((v) => !v)}
            disabled={!canToggle}
            aria-expanded={expanded}
            aria-controls="executive-summary-body"
            className={cn(
              "flex items-center gap-2 min-w-0 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
              canToggle ? "cursor-pointer" : "cursor-default",
            )}
          >
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">Resumo da análise</span>
            {summary && (
              <Badge variant="outline" className={riskClasses[summary.risk_level]}>
                {riskLabel[summary.risk_level]}
              </Badge>
            )}
            {canToggle && (
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                  expanded && "rotate-180",
                )}
              />
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => generate()}
            disabled={loading}
            className="h-7 px-2 shrink-0"
            aria-label="Regenerar resumo"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>

        {loading && !summary ? (
          <div className="space-y-2 mt-3">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
          </div>
        ) : summary ? (
          <div id="executive-summary-body" className="mt-3">
            <p
              className={cn(
                "text-[15px] leading-[1.55] text-foreground tracking-[-0.005em]",
                !expanded && "line-clamp-2",
              )}
              style={{ fontWeight: 500 }}
            >
              <HighlightNarrative text={summary.headline} />
            </p>
            {expanded && (
              <>
                <ul className="mt-3 space-y-1.5">
                  {summary.bullets.map((b, i) => (
                    <li key={i} className="text-[13px] text-foreground/90 flex gap-2 leading-relaxed">
                      <span aria-hidden className="text-primary mt-[2px]">•</span>
                      <span className="flex-1">
                        <HighlightNarrative text={b} />
                      </span>
                    </li>
                  ))}
                </ul>
                {summary.recommended_action && (
                  <p className="text-[13px] italic text-foreground/80 mt-3 pt-3 border-t border-border/50">
                    <HighlightNarrative text={summary.recommended_action} />
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">Não foi possível gerar o resumo.</p>
        )}
      </CardContent>
    </Card>
  );
};
