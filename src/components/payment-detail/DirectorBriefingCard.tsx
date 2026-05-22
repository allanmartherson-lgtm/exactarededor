import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type RiskLevel = "baixo" | "medio" | "alto" | "critico";
interface DirectorBriefing {
  headline: string;
  bullets: string[];
  risk_level: RiskLevel;
  recommended_action: string;
  generated_at: string;
}

interface Props {
  paymentId: string;
  payment: { status?: string; processing_diagnostics?: unknown } | null;
  roles: string[];
}

const STALE_HOURS = 4;

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
  return Date.now() - new Date(generatedAt).getTime() < STALE_HOURS * 3600 * 1000;
}

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export const DirectorBriefingCard = ({ paymentId, payment, roles }: Props) => {
  const allowed = roles.includes("diretor") || roles.includes("admin");
  const statusOk = ["aguardando_aprovacao", "aprovado_em_revisao"].includes(payment?.status ?? "");

  const cached = (payment?.processing_diagnostics as Record<string, unknown> | undefined)?.director_briefing as
    | DirectorBriefing
    | undefined;

  const [briefing, setBriefing] = useState<DirectorBriefing | null>(
    cached && isFresh(cached.generated_at) ? cached : null,
  );
  const [loading, setLoading] = useState(false);
  const [exceptions, setExceptions] = useState<{ count: number; impact: number } | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-payment", {
        body: { payment_id: paymentId, mode: "director" },
      });
      if (error) throw error;
      if (data?.summary) setBriefing(data.summary);
      else if (data?.error) throw new Error(data.error);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar briefing";
      toast({ title: "Briefing IA", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    if (!allowed || !statusOk) return;
    if (!briefing && !loading) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, allowed, statusOk]);

  useEffect(() => {
    if (!allowed || !statusOk) return;
    (async () => {
      const { data } = await supabase
        .from("payment_items")
        .select("gross_amount, expected_amount")
        .eq("payment_id", paymentId)
        .eq("authorized_exception", true);
      if (!data) return;
      const impact = data.reduce(
        (s, it: { gross_amount?: number | null; expected_amount?: number | null }) =>
          s + (Number(it.gross_amount) || 0) - (Number(it.expected_amount) || 0),
        0,
      );
      setExceptions({ count: data.length, impact });
    })();
  }, [paymentId, allowed, statusOk]);

  if (!allowed || !statusOk) return null;

  return (
    <Card className="shadow-card border-amber-300 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Briefing para Aprovação
            </span>
            {briefing && (
              <Badge variant="outline" className={riskClasses[briefing.risk_level]}>
                {riskLabel[briefing.risk_level]}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            disabled={loading}
            className="h-7 px-2 shrink-0"
            aria-label="Regenerar briefing"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>

        {loading && !briefing ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
          </div>
        ) : briefing ? (
          <>
            <p className="text-sm font-semibold leading-snug">{briefing.headline}</p>
            <ul className="mt-2 space-y-1">
              {briefing.bullets.map((b, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2 leading-relaxed">
                  <span aria-hidden className="text-amber-600 mt-[1px]">•</span>
                  <span className="flex-1">{b}</span>
                </li>
              ))}
            </ul>

            {exceptions && exceptions.count > 0 && (
              <div className="mt-3 pt-3 border-t border-amber-300/60 dark:border-amber-800/60">
                <p className="text-xs">
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    {exceptions.count} exceç{exceptions.count === 1 ? "ão" : "ões"} autorizada{exceptions.count === 1 ? "" : "s"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    pelos analistas (impacto: {fmtBRL(exceptions.impact)})
                  </span>
                </p>
              </div>
            )}

            {briefing.recommended_action && (
              <div className="mt-3 pt-3 border-t border-amber-300/60 dark:border-amber-800/60 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs italic text-muted-foreground flex-1 min-w-[200px]">
                  {briefing.recommended_action}
                </p>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs border-success/40 text-success hover:bg-success-soft" disabled>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aprovar
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10" disabled>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Devolver
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Não foi possível gerar o briefing.</p>
        )}
      </CardContent>
    </Card>
  );
};
