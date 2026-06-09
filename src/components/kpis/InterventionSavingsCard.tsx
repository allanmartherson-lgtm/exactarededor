/**
 * Card compacto "Valor ajustado por intervenção" — reusável em painéis
 * (Kpis, ExecutiveDashboard, AnalystProductivity). Busca a RPC e mostra
 * o saldo líquido com indicador de tom + link para o relatório completo.
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/status";
import {
  emptyResult,
  impactTone,
  type InterventionSavingsResult,
} from "@/lib/interventionSavings";

interface Props {
  rangeDays?: number;
  className?: string;
  hideHeader?: boolean;
}

export default function InterventionSavingsCard({ rangeDays = 30, className, hideHeader = false }: Props) {
  const { hasRole } = useAuth();
  const hospitalId = useActiveHospitalId();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());

  const allowed = hasRole("diretor") || hasRole("admin") || hasRole("validador");

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - rangeDays * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_intervention_savings", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: hospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
      } catch (e) {
        console.error("InterventionSavingsCard failed", e);
        if (!cancelled) setData(emptyResult());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeDays, hospitalId, allowed]);

  if (!allowed) return null;

  const s = data.summary;
  const tone = impactTone(s.saldo);
  const ring =
    tone === "positive" ? "border-success/30" :
    tone === "negative" ? "border-destructive/30" : "border-border";
  const accent =
    tone === "positive" ? "text-success" :
    tone === "negative" ? "text-destructive" : "text-muted-foreground";
  const Icon = tone === "negative" ? TrendingDown : tone === "positive" ? TrendingUp : Scale;

  const saldoLabel =
    tone === "positive"
      ? "Economia líquida para o hospital"
      : tone === "negative"
      ? "Pagamento adicional após revisão"
      : "Sem impacto líquido no período";

  return (
    <Card className={`shadow-card border ${ring} ${className ?? ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            {!hideHeader && (
              <>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Impacto das intervenções no pagamento
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Quanto a análise da equipe poupou (ou acrescentou) ao hospital — últimos {rangeDays} dias
                </p>
              </>
            )}
            {hideHeader && (
              <p className="text-[11px] text-muted-foreground">
                Quanto a análise da equipe poupou (ou acrescentou) ao hospital — últimos {rangeDays} dias
              </p>
            )}
          </div>
          <Icon className={`h-4 w-4 ${accent}`} />
        </div>

        {loading ? (
          <Skeleton className="h-8 w-40 mt-3" />
        ) : (
          <>
            <div className={`text-2xl font-semibold mt-2 ${accent}`}>
              {tone === "positive" ? "−" : tone === "negative" ? "+" : ""}
              {formatCurrency(Math.abs(s.saldo))}
            </div>
            <p className={`text-[11px] mt-0.5 font-medium ${accent}`}>{saldoLabel}</p>
          </>
        )}

        {!loading && (
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              <span>
                <span className="text-success font-medium">{formatCurrency(s.economia)}</span> deixou de ser pago indevidamente
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
              <span>
                <span className="text-destructive font-medium">{formatCurrency(s.perda)}</span> acrescido após revisão (ajustes para mais)
              </span>
            </div>
            <div className="text-muted-foreground/80 pt-0.5">
              {s.qtd_itens} item(ns) impactado(s) por devolução, ajuste ou cancelamento
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/relatorios/intervencoes?view=ajustes">
              Ver relatório <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
