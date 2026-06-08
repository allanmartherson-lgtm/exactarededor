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
}

export default function InterventionSavingsCard({ rangeDays = 30, className }: Props) {
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

  return (
    <Card className={`shadow-card border ${ring} ${className ?? ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Valor ajustado por intervenção
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Saldo líquido — últimos {rangeDays} dias
            </p>
          </div>
          <Icon className={`h-4 w-4 ${accent}`} />
        </div>

        {loading ? (
          <Skeleton className="h-8 w-40 mt-3" />
        ) : (
          <div className={`text-2xl font-semibold mt-2 ${accent}`}>
            {formatCurrency(s.saldo)}
          </div>
        )}

        {!loading && (
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <div>
              <span className="text-success">+{formatCurrency(s.economia)}</span> economia
              {" · "}
              <span className="text-destructive">−{formatCurrency(s.perda)}</span> perda
            </div>
            <div>{s.qtd_itens} item(ns) ajustado(s) após devolução/reprovação</div>
          </div>
        )}

        <div className="mt-3">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/relatorios/ajustes-intervencao">
              Ver relatório <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
