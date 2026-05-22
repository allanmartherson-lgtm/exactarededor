import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Calculator, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatBRL, mean } from "@/lib/financialStats";

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  status: string;
}

const EXCLUDED = new Set(["rascunho", "cancelado", "rejeitado"]);

export const ProjectionTab = () => {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const { data } = await supabase
        .from("payments")
        .select("competence_month,total_amount,status")
        .gte("competence_month", cutoff.toISOString().slice(0, 10));
      setRows((data as PaymentRow[]) ?? []);
    })();
  }, []);

  const result = useMemo(() => {
    if (!rows) return null;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.competence_month || EXCLUDED.has(r.status)) continue;
      const key = r.competence_month.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(r.total_amount));
    }
    const months = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    if (months.length === 0) return { projection: 0, currentTotal: 0, delta: 0, months: [] };
    const last3 = months.slice(-3).map(([, v]) => v);
    const projection = mean(last3);
    const currentTotal = months[months.length - 1][1];
    const delta = currentTotal > 0 ? ((projection - currentTotal) / currentTotal) * 100 : 0;
    return { projection, currentTotal, delta, months };
  }, [rows]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Projeção do próximo mês"
        icon={Calculator}
        iconColor="blue"
        subtitle="Média móvel dos últimos 3 meses"
      />
      <div className="p-6">
        {!result ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Projeção
              </p>
              <p className="text-3xl font-light tabular-nums">{formatBRL(result.projection)}</p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Mês atual
              </p>
              <p className="text-3xl font-light tabular-nums">{formatBRL(result.currentTotal)}</p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Variação
              </p>
              <p className="text-3xl font-light tabular-nums flex items-center gap-2">
                {result.delta > 0 ? (
                  <ArrowUp className="h-6 w-6 text-destructive" />
                ) : result.delta < 0 ? (
                  <ArrowDown className="h-6 w-6 text-success" />
                ) : (
                  <Minus className="h-6 w-6 text-muted-foreground" />
                )}
                {result.delta.toFixed(1)}%
              </p>
            </div>
          </div>
        )}
        {result && result.months.length > 0 && (
          <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {result.months.map(([m, v]) => (
              <div key={m} className="rounded border p-3 text-center">
                <p className="text-xs text-muted-foreground">{m}</p>
                <p className="text-sm font-medium tabular-nums mt-1">{formatBRL(v)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
