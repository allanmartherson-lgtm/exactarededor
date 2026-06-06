import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";

type FunnelStage = {
  stage: string;
  stage_order: number;
  payment_count: number;
  total_value: number;
  avg_age_days: number;
};

// Paleta coerente com o tema, evitando vermelho (reservado a erro).
const STAGE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 199 89% 48%))",
  "hsl(var(--chart-3, 262 83% 58%))",
  "hsl(var(--chart-4, 173 58% 39%))",
  "hsl(var(--chart-5, 43 96% 56%))",
  "hsl(var(--chart-6, 280 65% 60%))",
  "hsl(var(--chart-7, 217 91% 60%))",
  "hsl(var(--chart-8, 142 71% 45%))",
];

export const FunnelTab = () => {
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("get_money_funnel", {
          p_start_date: null,
          p_end_date: null,
        });
        if (error) throw error;
        setFunnel((data ?? []) as FunnelStage[]);
      } catch (e) {
        toast.error("Erro ao carregar funil");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stages = [...funnel].sort((a, b) => a.stage_order - b.stage_order);
  const totalValue = stages.reduce((acc, s) => acc + (Number(s.total_value) || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de pagamentos por estágio</CardTitle>
        <p className="text-xs text-muted-foreground">
          Largura proporcional ao valor parado em cada estágio.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <>
            <div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </>
        )}

        {!loading && stages.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum pagamento no período.</p>
        )}

        {!loading && stages.length > 0 && totalValue > 0 && (
          <>
            <div
              className="flex h-8 w-full overflow-hidden rounded-lg border border-border"
              role="img"
              aria-label="Distribuição de valor por estágio do funil"
            >
              {stages.map((s, idx) => {
                const pct = ((Number(s.total_value) || 0) / totalValue) * 100;
                const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                return (
                  <div
                    key={s.stage}
                    title={`${s.stage} · ${formatCurrency(s.total_value)} (${pct.toFixed(1)}%)`}
                    style={{
                      width: `${pct}%`,
                      minWidth: 4,
                      backgroundColor: color,
                    }}
                  />
                );
              })}
            </div>

            <ul className="space-y-2">
              {stages.map((s, idx) => {
                const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                return (
                  <li key={s.stage} className="flex items-start gap-2 text-sm">
                    <span
                      className="mt-1.5 inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="flex-1">
                      <span className="font-semibold text-foreground">{s.stage}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatCurrency(s.total_value)} · {s.payment_count} pagto(s) · tempo
                        médio parado: {s.avg_age_days}d
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
};
