import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, BarChart2, BrainCircuit, Clock, Download, Star, Trophy, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

type TabValue = "produtividade" | "accuracy" | "dwell" | "returns";

const PILLS: { value: TabValue; label: string }[] = [
  { value: "produtividade", label: "Produtividade" },
  { value: "accuracy", label: "Acurácia IA" },
  { value: "dwell", label: "Tempo por estágio" },
  { value: "returns", label: "Taxa de devolução" },
];

export default function ProcessHealth() {
  const [active, setActive] = useState<TabValue>("produtividade");

  useEffect(() => {
    document.title = "Saúde do Processo | Exacta";
  }, []);

  return (
    <div>
      <PageHeader
        title="Saúde do Processo"
        description="Produtividade da equipe, acurácia da IA, tempo por estágio e taxa de devolução"
        icon={Activity}
        showBack={false}
      />
      <div className="p-6 space-y-6">
        <nav className="flex flex-wrap gap-2" aria-label="Seções de Saúde do Processo">
          {PILLS.map((item) => {
            const isActive = active === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setActive(item.value)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {active === "produtividade" && <ProdutividadeSection />}
        {active === "accuracy" && <AccuracySection />}
        {active === "dwell" && <DwellSection />}
        {active === "returns" && <ReturnsSection />}
      </div>
    </div>
  );
}

/* ---------- Produtividade (extraído de AnalystProductivity) ---------- */

type Period = "30" | "60" | "90";

type Row = {
  id: string;
  name: string;
  lotesProcessados: number;
  validacoes: number;
  aprovacoes: number;
  devolucoes: number;
  ultimaAtividade: string | null;
};

const TOUCH_TARGETS = new Set(["concluida_analista", "devolvido_analista", "aguardando_validacao"]);

function ProdutividadeSection() {
  const [period, setPeriod] = useState<Period>("30");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - Number(period));
      const { data: history } = await supabase
        .from("payment_status_history")
        .select("changed_by, status_from, status_to, changed_at, payment_id")
        .gte("changed_at", since.toISOString())
        .not("changed_by", "is", null)
        .limit(10000);

      const userIds = Array.from(
        new Set((history ?? []).map((h: any) => h.changed_by).filter(Boolean))
      );
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

      const nameById = new Map<string, string>();
      (profiles ?? []).forEach((p: any) =>
        nameById.set(p.id, p.full_name || p.email || p.id.slice(0, 8))
      );

      const map = new Map<string, Row>();
      const ensure = (id: string): Row => {
        let r = map.get(id);
        if (!r) {
          r = {
            id,
            name: nameById.get(id) || id.slice(0, 8),
            lotesProcessados: 0,
            validacoes: 0,
            aprovacoes: 0,
            devolucoes: 0,
            ultimaAtividade: null,
          };
          map.set(id, r);
        }
        return r;
      };

      (history ?? []).forEach((h: any) => {
        const r = ensure(h.changed_by);
        if (TOUCH_TARGETS.has(h.status_to)) r.lotesProcessados += 1;
        if (h.status_to === "aprovado") r.aprovacoes += 1;
        if (h.status_to === "aguardando_aprovacao") r.validacoes += 1;
        if (h.status_to === "devolvido_analista") r.devolucoes += 1;
        if (!r.ultimaAtividade || h.changed_at > r.ultimaAtividade) {
          r.ultimaAtividade = h.changed_at;
        }
      });

      const list = Array.from(map.values()).sort(
        (a, b) => b.lotesProcessados - a.lotesProcessados
      );
      if (!cancelled) {
        setRows(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const topProcessor = rows[0];
  const bestQuality = useMemo(() => {
    const eligible = rows.filter((r) => r.lotesProcessados >= 5);
    if (!eligible.length) return null;
    return eligible
      .map((r) => ({ r, rate: r.devolucoes / Math.max(1, r.lotesProcessados) }))
      .sort((a, b) => a.rate - b.rate)[0];
  }, [rows]);

  const exportCsv = () => {
    const header = "Analista,Lotes processados,Validacoes,Aprovacoes,Devolucoes,Ultima atividade\n";
    const body = rows
      .map((r) =>
        [
          r.name.replace(/,/g, " "),
          r.lotesProcessados,
          r.validacoes,
          r.aprovacoes,
          r.devolucoes,
          r.ultimaAtividade ?? "",
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtividade_equipe_${period}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const devBadge = (n: number) => {
    if (n === 0) return <Badge className="bg-success/15 text-success border-success/30">0</Badge>;
    if (n <= 2)
      return <Badge className="bg-warning/15 text-warning-text border-warning/30">{n}</Badge>;
    return <Badge className="bg-destructive/15 text-destructive border-destructive/30">{n}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Produtividade da Equipe</h2>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Quantas ações cada pessoa fez no período (lotes processados, validações, aprovações) e quantas devoluções recebeu. Menos devolução = melhor qualidade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => v && setPeriod(v as Period)}
            size="sm"
          >
            <ToggleGroupItem value="30">30 dias</ToggleGroupItem>
            <ToggleGroupItem value="60">60 dias</ToggleGroupItem>
            <ToggleGroupItem value="90">90 dias</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Membro da equipe</th>
                  <th className="px-3 py-2 text-right">Lotes processados</th>
                  <th className="px-3 py-2 text-right">Validações</th>
                  <th className="px-3 py-2 text-right">Aprovações</th>
                  <th className="px-3 py-2 text-right">Devoluções recebidas</th>
                  <th className="px-3 py-2">Última atividade</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Sem atividade no período.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        to={`/pagamentos?owner=me&analista=${r.id}`}
                        className="text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.lotesProcessados}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.validacoes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.aprovacoes}</td>
                    <td className="px-3 py-2 text-right">{devBadge(r.devolucoes)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.ultimaAtividade ? formatDateTimeBR(r.ultimaAtividade) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Destaque do período</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-600" />
            {topProcessor ? (
              <span>
                <strong>{topProcessor.name}</strong> — {topProcessor.lotesProcessados} lotes
                processados
              </span>
            ) : (
              <span className="text-muted-foreground">Sem dados</span>
            )}
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-emerald-600" />
            {bestQuality ? (
              <span>
                <strong>{bestQuality.r.name}</strong> — {(bestQuality.rate * 100).toFixed(1)}% de
                devolução
              </span>
            ) : (
              <span className="text-muted-foreground">Sem dados (mín. 5 lotes)</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Observabilidade (extraído de BusinessObservability) ---------- */

type Dwell = { status: string; transitions: number; avg_hours: number; p50_hours: number; p90_hours: number };
type Ret = { return_status: string; return_count: number; total_in_stage: number; return_rate_pct: number };
type Accuracy = {
  total_analyzed: number;
  kept_count: number;
  overridden_count: number;
  accuracy_pct: number;
  by_status: Record<string, number>;
};

function useObservability() {
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

  return { dwell, returns, accuracy, loading };
}

function AccuracySection() {
  const { accuracy, loading } = useObservability();
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Mede a confiabilidade da pré-classificação da IA: a "Acurácia" é a % de itens em que o analista manteve a sugestão da IA sem sobrescrever.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" /> Distribuição por classificação da IA
          </CardTitle>
        </CardHeader>
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
    </div>
  );
}

function DwellSection() {
  const { dwell, loading } = useObservability();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" /> Tempo médio em cada status (últimos 90 dias)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quanto tempo os pagamentos ficam parados em cada status. P50 = mediana; P90 = 90% levam até esse tempo (P90 alto indica uma cauda de casos muito lentos).
        </p>
      </CardHeader>
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
  );
}

function ReturnsSection() {
  const { returns, loading } = useObservability();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Undo2 className="h-4 w-4" /> Taxa de devolução (últimos 30 dias)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          % de pagamentos devolvidos entre etapas — mede retrabalho. Quanto menor, melhor.
        </p>
      </CardHeader>
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
  );
}
