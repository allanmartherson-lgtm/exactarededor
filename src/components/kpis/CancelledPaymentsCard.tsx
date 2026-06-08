/**
 * Card resumo "Pagamentos cancelados (não-devidos)" para painéis.
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/status";
import {
  emptyCancelledResult,
  reasonLabel,
  type CancelledResult,
} from "@/lib/cancelledPayments";

interface Props { rangeDays?: number; className?: string }

export default function CancelledPaymentsCard({ rangeDays = 30, className }: Props) {
  const { hasRole } = useAuth();
  const hospitalId = useActiveHospitalId();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CancelledResult>(emptyCancelledResult());

  const allowed = hasRole("diretor") || hasRole("admin") || hasRole("validador") || hasRole("analista");

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - rangeDays * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_cancelled_payments_summary", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: hospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as CancelledResult) ?? emptyCancelledResult());
      } catch (e) {
        console.error("CancelledPaymentsCard failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rangeDays, hospitalId, allowed]);

  if (!allowed) return null;

  const s = data.summary;
  const top = data.by_reason.slice(0, 3);

  return (
    <Card className={`shadow-card border ${className ?? ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Pagamentos cancelados
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Não-devidos — últimos {rangeDays} dias
            </p>
          </div>
          <XCircle className="h-4 w-4 text-muted-foreground" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-40 mt-3" />
        ) : (
          <div className="text-2xl font-semibold mt-2">
            {formatCurrency(s.valor_total)}
          </div>
        )}
        {!loading && (
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <div>{s.qtd_grupos} grupo(s) · {s.qtd_itens} item(ns) avulso(s)</div>
            {top.length > 0 && (
              <div className="pt-1">
                <strong className="text-foreground">Top motivos:</strong>{" "}
                {top.map((t) => `${reasonLabel(t.reason)} (${formatCurrency(t.valor)})`).join(" · ")}
              </div>
            )}
          </div>
        )}
        <div className="mt-3">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/relatorios/pagamentos-cancelados">
              Ver relatório <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
