/**
 * Relatório dedicado de correções de valor feitas pelo analista durante a análise.
 *
 * Origem: observações `payment_observations` com `author_type='analista'` cujo `message`
 * casa o padrão "Item editado pelo analista (valor: X → Y)".
 *
 * Reutiliza a mesma RPC `get_intervention_savings` (papel = 'analista') e foca em
 * mostrar valor original, valor corrigido e o impacto financeiro item a item.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Download, Pencil, Scale, TrendingDown, TrendingUp } from "lucide-react";
import {
  classifyDelta,
  emptyResult,
  itemsToCsv,
  summarizeItems,
  type InterventionItem,
  type InterventionSavingsResult,
} from "@/lib/interventionSavings";

type Range = 7 | 30 | 90 | 180;

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function AnalystCorrections() {
  const currentHospitalId = useActiveHospitalId();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [search, setSearch] = useState("");
  const [impactFilter, setImpactFilter] = useState<"all" | "economia" | "aumento">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_intervention_savings", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: currentHospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
      } catch (e) {
        console.error(e);
        toast.error("Falha ao carregar correções de analista");
        if (!cancelled) setData(emptyResult());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range, currentHospitalId]);

  const analystItems: InterventionItem[] = useMemo(
    () => data.items.filter((it) => it.role === "analista"),
    [data.items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return analystItems.filter((it) => {
      const cls = classifyDelta(it.delta);
      if (impactFilter !== "all" && cls !== impactFilter) return false;
      if (!q) return true;
      const hay = [it.autor, it.company_name, it.doctor_name, it.procedure_code, it.procedure_name]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [analystItems, search, impactFilter]);

  const summary = useMemo(() => summarizeItems(filtered), [filtered]);

  return (
    <div>
      <PageHeader
        title="Correções em análise"
        description="Itens cujo valor foi ajustado pelo analista durante a análise — original, corrigido e impacto no pagamento"
        icon={Pencil}
        showBack
      />
      <div className="p-4 md:p-6 space-y-4">
        {/* Filtros */}
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Período</label>
              <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as Range)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7d</SelectItem>
                  <SelectItem value="30">Últimos 30d</SelectItem>
                  <SelectItem value="90">Últimos 90d</SelectItem>
                  <SelectItem value="180">Últimos 180d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Impacto</label>
              <Select value={impactFilter} onValueChange={(v) => setImpactFilter(v as typeof impactFilter)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="economia">Apenas economia</SelectItem>
                  <SelectItem value="aumento">Apenas aumento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">Buscar</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Empresa, médico, procedimento, analista"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => downloadCsv(`correcoes-analista-${range}d.csv`, itemsToCsv(filtered))}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard icon={Pencil} label="Itens corrigidos" value={String(summary.qtd_itens)} hint="Edições no período" tone="muted" loading={loading} />
          <KpiCard icon={TrendingUp} label="Economia" value={formatCurrency(summary.economia)} hint="Valor corrigido < original" tone="success" loading={loading} />
          <KpiCard icon={TrendingDown} label="Aumento" value={formatCurrency(summary.perda)} hint="Valor corrigido > original" tone="destructive" loading={loading} />
          <KpiCard icon={Scale} label="Saldo líquido" value={formatCurrency(summary.saldo)} hint="Economia − aumento" tone={summary.saldo > 0 ? "success" : summary.saldo < 0 ? "destructive" : "muted"} loading={loading} />
        </div>

        {/* Tabela */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Itens ajustados pelo analista ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Analista</TableHead>
                    <TableHead>Empresa / Médico</TableHead>
                    <TableHead>Procedimento</TableHead>
                    <TableHead className="text-right">Valor original</TableHead>
                    <TableHead className="text-right">Valor corrigido</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Impacto</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={9}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  )}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-muted-foreground text-center py-6">
                        Nenhuma correção de analista no período.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && filtered.map((it) => {
                    const cls = classifyDelta(it.delta);
                    const isEcon = cls === "economia";
                    const isAum = cls === "aumento";
                    return (
                      <TableRow key={`${it.item_id}-${it.obs_id}`}>
                        <TableCell className="text-sm">{fmtDate(it.obs_at)}</TableCell>
                        <TableCell className="text-sm">{it.autor}</TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{it.company_name ?? "—"}</div>
                          <div className="text-muted-foreground">{it.doctor_name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-mono text-xs">{it.procedure_code ?? ""}</div>
                          <div className="text-muted-foreground">{it.procedure_name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(it.valor_regra)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(it.valor_pago_final)}</TableCell>
                        <TableCell className={`text-right font-semibold ${isEcon ? "text-success" : isAum ? "text-destructive" : ""}`}>
                          <span className="inline-flex items-center gap-1">
                            {isEcon ? <ArrowUpRight className="h-3 w-3" /> : isAum ? <ArrowDownRight className="h-3 w-3" /> : null}
                            {formatCurrency(Math.abs(it.delta))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              isEcon ? "border-success/40 text-success bg-success/5" :
                              isAum ? "border-destructive/40 text-destructive bg-destructive/5" :
                              "border-border text-muted-foreground"
                            }
                          >
                            {isEcon ? "Economia" : isAum ? "Aumento" : "Neutro"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/pagamentos/${it.payment_id}#item-${it.item_id}`}>Abrir</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, hint, tone, loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string;
  tone: "success" | "destructive" | "muted";
  loading?: boolean;
}) {
  const ring =
    tone === "success" ? "border-success/30" :
    tone === "destructive" ? "border-destructive/30" :
    "border-border";
  const iconColor =
    tone === "success" ? "text-success" :
    tone === "destructive" ? "text-destructive" :
    "text-muted-foreground";
  return (
    <Card className={`shadow-card ${ring} border`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        {loading ? <Skeleton className="h-7 w-32 mt-2" /> : <div className="text-2xl font-semibold mt-1">{value}</div>}
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
