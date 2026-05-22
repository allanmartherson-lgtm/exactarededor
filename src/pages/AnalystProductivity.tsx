import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Download, Trophy, Star, BarChart2 } from "lucide-react";
import { formatDateTimeBR } from "@/lib/dateUtils";

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

export default function AnalystProductivity() {
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
    a.download = `produtividade_analistas_${period}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const devBadge = (n: number) => {
    if (n === 0) return <Badge className="bg-success/15 text-success border-success/30">0</Badge>;
    if (n <= 2)
      return <Badge className="bg-warning/15 text-warning-foreground border-warning/30">{n}</Badge>;
    return <Badge className="bg-destructive/15 text-destructive border-destructive/30">{n}</Badge>;
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Produtividade dos Analistas</h1>
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
                  <th className="px-3 py-2">Analista</th>
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
