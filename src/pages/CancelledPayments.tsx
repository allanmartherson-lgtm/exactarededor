import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Download, RotateCcw, XCircle } from "lucide-react";
import {
  ALL_REASONS,
  REASON_LABELS,
  type CancelledFilters,
  type CancelledResult,
  type CancellationReason,
  cancelledToCsv,
  emptyCancelledResult,
  filterCancelled,
  reasonLabel,
  summarizeRows,
} from "@/lib/cancelledPayments";

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

export default function CancelledPayments() {
  const hospitalId = useActiveHospitalId();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CancelledResult>(emptyCancelledResult());
  const [filters, setFilters] = useState<CancelledFilters>({
    reason: "all", nivel: "all", search: "", includeReactivated: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_cancelled_payments_summary", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: hospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData((res as unknown as CancelledResult) ?? emptyCancelledResult());
      } catch (e) {
        console.error(e);
        toast.error("Falha ao carregar pagamentos cancelados");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range, hospitalId]);

  const filtered = useMemo(() => filterCancelled(data.items, filters), [data.items, filters]);
  const summary = useMemo(() => summarizeRows(filtered), [filtered]);
  const maxByReason = Math.max(1, ...data.by_reason.map((r) => Number(r.valor) || 0));

  const reactivate = async (row: { nivel: "grupo" | "item"; id: string }) => {
    const fn = row.nivel === "grupo" ? "reactivate_cancelled_group" : "reactivate_cancelled_item";
    const args = row.nivel === "grupo" ? { p_group_id: row.id } : { p_item_id: row.id };
    const { error } = await supabase.rpc(fn, args as never);
    if (error) {
      toast.error(`Falha ao reativar: ${error.message}`);
    } else {
      toast.success("Pagamento reativado");
      // refetch
      setRange((r) => r);
      const end = new Date();
      const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
      const { data: res } = await supabase.rpc("get_cancelled_payments_summary", {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
        p_hospital_id: hospitalId ?? null,
      });
      setData((res as unknown as CancelledResult) ?? emptyCancelledResult());
    }
  };

  return (
    <div>
      <PageHeader
        title="Pagamentos cancelados"
        description="Pagamentos marcados como não-devidos (médico fatura externamente, contrato encerrado, glosa total, etc)"
        icon={XCircle}
        showBack
      />
      <div className="p-4 md:p-6 space-y-4">
        {/* Filtros */}
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Período</Label>
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
              <Label className="text-xs text-muted-foreground">Motivo</Label>
              <Select
                value={filters.reason ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, reason: v as CancellationReason | "all" }))}
              >
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {ALL_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nível</Label>
              <Select
                value={filters.nivel ?? "all"}
                onValueChange={(v) => setFilters((f) => ({ ...f, nivel: v as "grupo" | "item" | "all" }))}
              >
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="grupo">Empresa</SelectItem>
                  <SelectItem value="item">Item avulso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Buscar</Label>
              <Input
                value={filters.search ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Empresa, médico, observação…"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                id="include-reactivated"
                checked={!!filters.includeReactivated}
                onCheckedChange={(c) => setFilters((f) => ({ ...f, includeReactivated: c }))}
              />
              <Label htmlFor="include-reactivated" className="text-xs">Incluir reativados</Label>
            </div>
            <Button
              variant="outline"
              onClick={() => downloadCsv(`pagamentos-cancelados-${range}d.csv`, cancelledToCsv(filtered))}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SimpleKpi label="Valor total cancelado" value={formatCurrency(summary.valor_total)} loading={loading} />
          <SimpleKpi label="Empresas cancelaadas" value={String(summary.qtd_grupos)} loading={loading} />
          <SimpleKpi label="Itens avulsos cancelados" value={String(summary.qtd_itens)} loading={loading} />
        </div>

        {/* Quebra por motivo */}
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Quebra por motivo</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading && <Skeleton className="h-4 w-full" />}
            {!loading && data.by_reason.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem cancelamentos no período.</p>
            )}
            {!loading && data.by_reason.map((r) => (
              <div key={r.reason} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{reasonLabel(r.reason)}</span>
                  <span className="text-muted-foreground">
                    {r.qtd} ocorr. · {formatCurrency(r.valor)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded">
                  <div
                    className="h-2 bg-destructive rounded"
                    style={{ width: `${((Number(r.valor) || 0) / maxByReason) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Drill-down */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Cancelamentos ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[560px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nível</TableHead>
                    <TableHead>Empresa / Médico</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  )}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                        Sem cancelamentos para os filtros atuais.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && filtered.map((r) => (
                    <TableRow key={`${r.nivel}-${r.id}`}>
                      <TableCell className="text-sm">
                        {new Date(r.cancelled_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.nivel === "grupo" ? "Empresa" : "Item"}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{r.company_name ?? "—"}</div>
                        {r.doctor_name && (
                          <div className="text-muted-foreground">{r.doctor_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{reasonLabel(r.reason)}</div>
                        {r.note && <div className="text-xs text-muted-foreground italic">{r.note}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{r.autor}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.valor)}</TableCell>
                      <TableCell>
                        {r.reactivated ? (
                          <Badge variant="secondary">Reativado</Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive/40">
                            Cancelado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/pagamentos/${r.payment_id}`}>Abrir</Link>
                        </Button>
                        {!r.reactivated && (
                          <Button size="sm" variant="ghost" onClick={() => reactivate(r)}>
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reativar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SimpleKpi({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="h-7 w-32 mt-2" /> : <div className="text-2xl font-semibold mt-1">{value}</div>}
      </CardContent>
    </Card>
  );
}
