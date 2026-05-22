import { useMemo, useState } from "react";
import { Download, MessageSquare, Sparkles } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface ObservationRow {
  id: string;
  message: string | null;
  author_type: string | null;
  observation_type: string | null;
  created_at: string;
  payment_id: string | null;
}

interface Classified {
  id: string;
  category: string;
  subcategory: string;
  sentiment: "positivo" | "neutro" | "negativo";
}

interface EnrichedRow extends ObservationRow {
  category: string;
  subcategory: string;
  sentiment: string;
}

const BATCH_SIZE = 50;

const sentimentColor: Record<string, string> = {
  positivo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  neutro: "bg-muted text-muted-foreground",
  negativo: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

export default function ObservationInsights() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterAuthor, setFilterAuthor] = useState<string>("all");

  const runClassification = async () => {
    setLoading(true);
    setRows([]);
    setProgress({ done: 0, total: 0 });

    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: obs, error } = await supabase
        .from("payment_observations")
        .select("id, message, author_type, observation_type, created_at, payment_id")
        .in("author_type", ["analista", "validador", "diretor"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      const list = (obs ?? []).filter((o) => (o.message ?? "").trim().length > 0);
      if (list.length === 0) {
        toast.info("Nenhuma observação encontrada nos últimos 90 dias.");
        setLoading(false);
        return;
      }

      setProgress({ done: 0, total: list.length });
      const classifiedById = new Map<string, Classified>();

      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE).map((o) => ({
          id: o.id,
          message: o.message ?? "",
          author_type: o.author_type ?? "",
        }));

        const { data, error: fnErr } = await supabase.functions.invoke(
          "classify-observations",
          { body: { observations: batch } },
        );
        if (fnErr) {
          toast.error(`Erro ao classificar batch: ${fnErr.message}`);
          break;
        }
        const classified: Classified[] = data?.classified ?? [];
        for (const c of classified) classifiedById.set(c.id, c);
        setProgress({ done: Math.min(i + BATCH_SIZE, list.length), total: list.length });
      }

      const enriched: EnrichedRow[] = list.map((o) => {
        const c = classifiedById.get(o.id);
        return {
          ...o,
          category: c?.category ?? "Outros",
          subcategory: c?.subcategory ?? "—",
          sentiment: c?.sentiment ?? "neutro",
        };
      });
      setRows(enriched);
      toast.success(`${enriched.length} observações classificadas.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha na classificação");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterCat !== "all" && r.category !== filterCat) return false;
      if (filterAuthor !== "all" && r.author_type !== filterAuthor) return false;
      return true;
    });
  }, [rows, filterCat, filterAuthor]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.category, (map.get(r.category) ?? 0) + 1);
    return Array.from(map.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const topCategory = categoryCounts[0];
  const topSubcategory = useMemo(() => {
    if (!topCategory) return null;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.category === topCategory.category) {
        map.set(r.subcategory, (map.get(r.subcategory) ?? 0) + 1);
      }
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return entries[0] ?? null;
  }, [rows, topCategory]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category))).sort(),
    [rows],
  );

  const exportCsv = () => {
    const headers = ["data", "autor", "categoria", "subcategoria", "sentimento", "mensagem"];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const cells = [
        r.created_at,
        r.author_type ?? "",
        r.category,
        r.subcategory,
        r.sentiment,
        (r.message ?? "").replace(/"/g, '""'),
      ].map((v) => `"${String(v).replace(/\n/g, " ")}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `insights-observacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxCount = categoryCounts[0]?.count ?? 1;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            Insights de Observações
          </h1>
          <p className="text-sm text-muted-foreground">
            Análise semântica das observações dos últimos 90 dias
          </p>
        </div>
        <Button onClick={runClassification} disabled={loading} className="gap-2">
          <Sparkles className="h-4 w-4" />
          {loading ? "Classificando..." : "Classificar observações"}
        </Button>
      </div>

      {loading && progress.total > 0 && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="text-sm">
              Classificando {progress.done}/{progress.total} observações...
            </div>
            <Progress value={(progress.done / progress.total) * 100} />
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && topCategory && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Causa raiz mais frequente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-lg font-semibold">
              {topCategory.category} — {topCategory.count} ocorrências nos últimos 90 dias
            </div>
            {topSubcategory && (
              <div className="text-sm text-muted-foreground">
                Subcategoria mais frequente: <strong>{topSubcategory[0]}</strong> ({topSubcategory[1]})
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top categorias</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: Math.max(220, categoryCounts.length * 36) }}>
              <ResponsiveContainer>
                <BarChart
                  data={categoryCounts}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 16 }}
                >
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis dataKey="category" type="category" width={160} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {categoryCounts.map((entry, idx) => {
                      const intensity = 0.3 + 0.7 * (entry.count / maxCount);
                      return (
                        <Cell
                          key={idx}
                          fill={`hsl(var(--primary) / ${intensity.toFixed(2)})`}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Detalhamento</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterAuthor} onValueChange={setFilterAuthor}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Autor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos autores</SelectItem>
                  <SelectItem value="analista">analista</SelectItem>
                  <SelectItem value="validador">validador</SelectItem>
                  <SelectItem value="diretor">diretor</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
                <Download className="h-4 w-4" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Subcategoria</TableHead>
                    <TableHead>Mensagem</TableHead>
                    <TableHead>Sentimento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs">{r.author_type}</TableCell>
                      <TableCell><Badge variant="secondary">{r.category}</Badge></TableCell>
                      <TableCell className="text-xs">{r.subcategory}</TableCell>
                      <TableCell className="text-xs max-w-md">
                        {(r.message ?? "").slice(0, 100)}
                        {(r.message ?? "").length > 100 ? "…" : ""}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${sentimentColor[r.sentiment] ?? sentimentColor.neutro}`}>
                          {r.sentiment}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                        Nenhuma observação para os filtros selecionados.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
