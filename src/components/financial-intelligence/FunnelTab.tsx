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

  const maxValue = Math.max(1, ...funnel.map((f) => Number(f.total_value) || 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de pagamentos por estágio (barras proporcionais ao valor)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && funnel.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum pagamento no período.</p>
        )}
        {funnel.map((s) => (
          <div key={s.stage} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{s.stage}</span>
              <span className="text-muted-foreground">
                {s.payment_count} pagto(s) · {formatCurrency(s.total_value)} · tempo médio parado: {s.avg_age_days}d
              </span>
            </div>
            <div className="h-2 bg-muted rounded">
              <div
                className="h-2 bg-primary rounded"
                style={{ width: `${((Number(s.total_value) || 0) / maxValue) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
