import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, Building2, TrendingUp, XCircle } from "lucide-react";
import { CancellationsTab } from "@/components/money-health/CancellationsTab";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";

type FunnelStage = {
  stage: string;
  stage_order: number;
  payment_count: number;
  total_value: number;
  avg_age_days: number;
};

type StuckCompany = {
  company_id: string;
  company_name: string;
  stuck_count: number;
  total_stuck_value: number;
  max_age_days: number;
  worst_status: string;
};

type Anomaly = {
  anomaly_type: string;
  severity: string;
  entity_id: string;
  entity_name: string;
  metric_value: number;
  baseline_value: number;
  detected_at: string;
  details: Record<string, unknown>;
};

export default function MoneyHealth() {
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [stuck, setStuck] = useState<StuckCompany[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [f, s, a] = await Promise.all([
          supabase.rpc("get_money_funnel", { p_start_date: null, p_end_date: null }),
          supabase.rpc("get_stuck_companies", { p_limit: 10 }),
          supabase.rpc("get_money_anomalies", { p_days: 30 }),
        ]);
        if (f.error) throw f.error;
        if (s.error) throw s.error;
        if (a.error) throw a.error;
        setFunnel((f.data ?? []) as FunnelStage[]);
        setStuck((s.data ?? []) as StuckCompany[]);
        setAnomalies((a.data ?? []) as Anomaly[]);
      } catch (e) {
        toast.error("Erro ao carregar Saúde do Dinheiro");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const maxValue = Math.max(1, ...funnel.map((f) => Number(f.total_value) || 0));

  const sevBadge = (s: string) =>
    s === "alta" ? "destructive" : s === "media" ? "default" : "secondary";

  return (
    <div>
      <PageHeader
        title="Saúde do Dinheiro"
        description="Funil financeiro, PJs travadas e anomalias do ciclo de pagamentos"
        icon={Activity}
        showBack={false}
      />
      <div className="p-6">
        <Tabs defaultValue="funnel" className="space-y-4">
          <TabsList>
            <TabsTrigger value="funnel">
              <TrendingUp className="h-4 w-4 mr-2" /> Funil
            </TabsTrigger>
            <TabsTrigger value="stuck">
              <Building2 className="h-4 w-4 mr-2" /> PJs travadas
            </TabsTrigger>
            <TabsTrigger value="anomalies">
              <AlertTriangle className="h-4 w-4 mr-2" /> Anomalias
            </TabsTrigger>
            <TabsTrigger value="cancellations">
              <XCircle className="h-4 w-4 mr-2" /> Cancelamentos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cancellations">
            <CancellationsTab />
          </TabsContent>

          <TabsContent value="funnel">
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
          </TabsContent>

          <TabsContent value="stuck">
            <Card>
              <CardHeader>
                <CardTitle>Top 10 PJs com pagamentos travados (&gt;7 dias)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead className="text-right">Pagtos travados</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Idade máx (d)</TableHead>
                      <TableHead>Pior status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow>
                    )}
                    {!loading && stuck.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem PJs travadas. 🎉</TableCell></TableRow>
                    )}
                    {stuck.map((c) => (
                      <TableRow key={c.company_id}>
                        <TableCell className="font-medium">{c.company_name}</TableCell>
                        <TableCell className="text-right">{c.stuck_count}</TableCell>
                        <TableCell className="text-right">{formatCurrency(c.total_stuck_value)}</TableCell>
                        <TableCell className="text-right">{c.max_age_days}</TableCell>
                        <TableCell><Badge variant="outline">{c.worst_status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="anomalies">
            <Card>
              <CardHeader>
                <CardTitle>Anomalias financeiras (últimos 30 dias)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Severidade</TableHead>
                      <TableHead>Entidade</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Baseline</TableHead>
                      <TableHead>Detectado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow><TableCell colSpan={6}>Carregando…</TableCell></TableRow>
                    )}
                    {!loading && anomalies.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhuma anomalia detectada.</TableCell></TableRow>
                    )}
                    {anomalies.map((a, i) => (
                      <TableRow key={`${a.entity_id}-${i}`}>
                        <TableCell>
                          {a.anomaly_type === "outlier_valor" ? "Outlier valor" : "Spike de glosa"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={sevBadge(a.severity) as "destructive" | "default" | "secondary"}>
                            {a.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{a.entity_name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(a.metric_value)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatCurrency(a.baseline_value)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(a.detected_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
