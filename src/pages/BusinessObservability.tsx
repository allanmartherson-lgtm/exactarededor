import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrainCircuit, Clock, Undo2, Activity } from "lucide-react";
import { toast } from "sonner";

type Dwell = { status: string; transitions: number; avg_hours: number; p50_hours: number; p90_hours: number };
type Ret = { return_status: string; return_count: number; total_in_stage: number; return_rate_pct: number };
type Accuracy = {
  total_analyzed: number;
  kept_count: number;
  overridden_count: number;
  accuracy_pct: number;
  by_status: Record<string, number>;
};

export default function BusinessObservability() {
  const [dwell, setDwell] = useState<Dwell[]>([]);
  const [returns, setReturns] = useState<Ret[]>([]);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [d, r, a] = await Promise.all([
          supabase.rpc("get_stage_dwell_time", { p_days: 90 }),
          supabase.rpc("get_return_rate", { p_days: 30 }),
          supabase.rpc("get_ai_accuracy", { p_days: 30 }),
        ]);
        if (d.error) throw d.error;
        if (r.error) throw r.error;
        if (a.error) throw a.error;
        setDwell((d.data ?? []) as Dwell[]);
        setReturns((r.data ?? []) as Ret[]);
        setAccuracy(((a.data ?? [])[0] ?? null) as Accuracy | null);
      } catch (e) {
        toast.error("Erro ao carregar observabilidade");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Observabilidade de Negócio"
        description="Acurácia da IA, tempo por estágio e taxa de devolução"
        icon={Activity}
        showBack={false}
      />
      <div className="p-6">
        <Tabs defaultValue="accuracy" className="space-y-4">
          <TabsList>
            <TabsTrigger value="accuracy"><BrainCircuit className="h-4 w-4 mr-2" />Acurácia IA</TabsTrigger>
            <TabsTrigger value="dwell"><Clock className="h-4 w-4 mr-2" />Tempo por estágio</TabsTrigger>
            <TabsTrigger value="returns"><Undo2 className="h-4 w-4 mr-2" />Taxa de devolução</TabsTrigger>
          </TabsList>

          <TabsContent value="accuracy">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Itens analisados</CardTitle></CardHeader>
                <CardContent className="text-2xl font-bold">{accuracy?.total_analyzed ?? 0}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">IA mantida</CardTitle></CardHeader>
                <CardContent className="text-2xl font-bold text-green-600">{accuracy?.kept_count ?? 0}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Override do analista</CardTitle></CardHeader>
                <CardContent className="text-2xl font-bold text-amber-600">{accuracy?.overridden_count ?? 0}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Acurácia</CardTitle></CardHeader>
                <CardContent className="text-2xl font-bold">{accuracy?.accuracy_pct ?? 0}%</CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Distribuição por ai_status</CardTitle></CardHeader>
              <CardContent>
                {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {!loading && accuracy && Object.keys(accuracy.by_status ?? {}).length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem análises no período.</p>
                )}
                <div className="space-y-2">
                  {Object.entries(accuracy?.by_status ?? {}).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="font-medium">{k}</span>
                      <span className="text-muted-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dwell">
            <Card>
              <CardHeader><CardTitle>Tempo médio em cada status (últimos 90 dias)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Transições</TableHead>
                      <TableHead className="text-right">Média (h)</TableHead>
                      <TableHead className="text-right">P50 (h)</TableHead>
                      <TableHead className="text-right">P90 (h)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow>}
                    {!loading && dwell.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem histórico no período.</TableCell></TableRow>
                    )}
                    {dwell.map((d) => (
                      <TableRow key={d.status}>
                        <TableCell className="font-medium">{d.status}</TableCell>
                        <TableCell className="text-right">{d.transitions}</TableCell>
                        <TableCell className="text-right">{d.avg_hours}</TableCell>
                        <TableCell className="text-right">{d.p50_hours}</TableCell>
                        <TableCell className="text-right">{d.p90_hours}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="returns">
            <Card>
              <CardHeader><CardTitle>Taxa de devolução (últimos 30 dias)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Etapa</TableHead>
                      <TableHead className="text-right">Devoluções</TableHead>
                      <TableHead className="text-right">Total na etapa</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && <TableRow><TableCell colSpan={4}>Carregando…</TableCell></TableRow>}
                    {!loading && returns.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground">Sem devoluções no período. 🎉</TableCell></TableRow>
                    )}
                    {returns.map((r) => (
                      <TableRow key={r.return_status}>
                        <TableCell className="font-medium">{r.return_status}</TableCell>
                        <TableCell className="text-right">{r.return_count}</TableCell>
                        <TableCell className="text-right">{r.total_in_stage}</TableCell>
                        <TableCell className="text-right font-bold">{r.return_rate_pct ?? 0}%</TableCell>
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
