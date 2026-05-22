import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-payment", {
        body: { payment_id: paymentId },
      });
      if (error) throw error;
      if (data?.summary) {
        setSummary(data.summary);
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar resumo";
      toast({ title: "Resumo IA", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    if (!summary && !loading) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  return (
    <Card className="shadow-card border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Resumo IA</span>
            {summary && (
              <Badge variant="outline" className={riskClasses[summary.risk_level]}>
                {riskLabel[summary.risk_level]}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            disabled={loading}
            className="h-7 px-2 shrink-0"
            aria-label="Regenerar resumo"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>

        {loading && !summary ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : summary ? (
          <>
            <p className="text-sm font-semibold leading-snug">{summary.headline}</p>
            <ul className="mt-2 space-y-1">
              {summary.bullets.map((b, i) => (
              <li key={i} className="text-xs text-foreground/90 flex gap-2 leading-relaxed">
                  <span aria-hidden className="text-primary mt-[1px]">•</span>
                  <span className="flex-1">{b}</span>
                </li>
              ))}
            </ul>
            {summary.recommended_action && (
              <p className="text-xs italic text-muted-foreground mt-3 pt-3 border-t border-border/50">
                {summary.recommended_action}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Não foi possível gerar o resumo.</p>
        )}
      </CardContent>
    </Card>
  );
};
