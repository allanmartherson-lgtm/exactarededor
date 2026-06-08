import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Download, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/status";
import { reasonLabel } from "@/lib/cancelledPayments";

type Range = 30 | 60 | 90 | 180 | 365;

type Group = {
  group_id: string;
  company_id: string | null;
  company_name: string | null;
  bruto_total: number;
  liquido_total: number;
  total_amount: number;
  reason: string | null;
  note: string | null;
  cancelled_at: string;
  reactivated: boolean;
  autor: string | null;
  items_cancelados: number;
};

type ByCompany = {
  company_id: string;
  company_name: string;
  qtd_grupos: number;
  qtd_ativos: number;
  qtd_reativados: number;
  bruto_total: number;
  liquido_total: number;
  total_amount: number;
  itens_cancelados: number;
  motivos: string[] | null;
};

type ByPayment = {
  payment_id: string;
  competencia: string | null;
  reference_month: string | null;
  grupos_afetados: number;
  bruto_total: number;
  liquido_total: number;
  total_amount: number;
  itens_cancelados: number;
  motivos: string[] | null;
  grupos: Group[];
};

type ByReason = {
  reason: string | null;
  qtd: number;
  bruto_total: number;
  liquido_total: number;
  total_amount: number;
};

type Totals = {
  qtd_grupos: number;
  qtd_pagamentos: number;
  qtd_empresas: number;
  bruto_total: number;
  liquido_total: number;
  total_amount: number;
  itens_cancelados: number;
  qtd_reativados: number;
};

type Report = {
  totals: Totals;
  by_reason: ByReason[];
  by_company: ByCompany[];
  by_payment: ByPayment[];
};

const EMPTY: Report = {
  totals: {
    qtd_grupos: 0, qtd_pagamentos: 0, qtd_empresas: 0,
    bruto_total: 0, liquido_total: 0, total_amount: 0,
    itens_cancelados: 0, qtd_reativados: 0,
  },
  by_reason: [], by_company: [], by_payment: [],
};

const csvDownload = (filename: string, rows: string[][]) => {
  const csv = rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export function CancellationsTab() {
  const hospitalId = useActiveHospitalId();
  const [range, setRange] = useState<Range>(90);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Report>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const end = new Date();
        const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
        const { data: res, error } = await supabase.rpc("get_cancellation_report_detailed", {
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_hospital_id: hospitalId ?? null,
        });
        if (error) throw error;
        if (!cancelled) setData(((res as unknown) as Report) ?? EMPTY);
      } catch (e) {
        console.error(e);
        toast.error("Falha ao carregar relatório de cancelamentos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range, hospitalId]);

  const maxBruto = useMemo(
    () => Math.max(1, ...data.by_reason.map((r) => Number(r.bruto_total) || 0)),
    [data.by_reason],
  );

  const exportByCompany = () => {
    const rows: string[][] = [
      ["empresa", "grupos", "ativos", "reativados", "itens_cancelados", "bruto_preservado", "liquido_preservado", "total_pagavel", "motivos"],
      ...data.by_company.map((c) => [
        c.company_name ?? "",
        String(c.qtd_grupos),
        String(c.qtd_ativos),
        String(c.qtd_reativados),
        String(c.itens_cancelados ?? 0),
        c.bruto_total.toFixed(2).replace(".", ","),
        c.liquido_total.toFixed(2).replace(".", ","),
        c.total_amount.toFixed(2).replace(".", ","),
        (c.motivos ?? []).map(reasonLabel).join(" / "),
      ]),
    ];
    csvDownload(`cancelamentos-por-empresa-${range}d.csv`, rows);
  };

  const exportByPayment = () => {
    const rows: string[][] = [
      ["payment_id", "competencia", "empresa", "grupo_id", "motivo", "bruto_preservado", "liquido_preservado", "total_pagavel", "itens_cancelados", "reativado", "data_cancelamento", "autor", "observacao"],
    ];
    for (const p of data.by_payment) {
      for (const g of p.grupos ?? []) {
        rows.push([
          p.payment_id,
          p.competencia ?? p.reference_month ?? "",
          g.company_name ?? "",
          g.group_id,
          reasonLabel(g.reason ?? ""),
          (g.bruto_total ?? 0).toFixed(2).replace(".", ","),
          (g.liquido_total ?? 0).toFixed(2).replace(".", ","),
          (g.total_amount ?? 0).toFixed(2).replace(".", ","),
          String(g.items_cancelados ?? 0),
          g.reactivated ? "sim" : "nao",
          g.cancelled_at,
          g.autor ?? "",
          g.note ?? "",
        ]);
      }
    }
    csvDownload(`cancelamentos-por-pagamento-${range}d.csv`, rows);
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Período</Label>
            <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as Range)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="60">Últimos 60 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="180">Últimos 180 dias</SelectItem>
                <SelectItem value="365">Últimos 365 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportByCompany} disabled={data.by_company.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV por empresa
            </Button>
            <Button variant="outline" size="sm" onClick={exportByPayment} disabled={data.by_payment.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV por pagamento
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Bruto preservado (vazamento)" value={formatCurrency(data.totals.bruto_total)} loading={loading} highlight />
        <Kpi label="Líquido preservado" value={formatCurrency(data.totals.liquido_total)} loading={loading} />
        <Kpi label="Pagamentos afetados" value={String(data.totals.qtd_pagamentos)} loading={loading} />
        <Kpi label="Empresas / grupos / itens" value={`${data.totals.qtd_empresas} / ${data.totals.qtd_grupos} / ${data.totals.itens_cancelados ?? 0}`} loading={loading} />
      </div>

      {/* Quebra por motivo */}
      <Card>
        <CardHeader><CardTitle className="text-base">Vazamento por motivo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading && <Skeleton className="h-4 w-full" />}
          {!loading && data.by_reason.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem cancelamentos no período.</p>
          )}
          {!loading && data.by_reason.map((r) => (
            <div key={r.reason ?? "x"} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{reasonLabel(r.reason ?? "")}</span>
                <span className="text-muted-foreground">
                  {r.qtd} grupo(s) · Bruto {formatCurrency(r.bruto_total)} · Líquido {formatCurrency(r.liquido_total)}
                </span>
              </div>
              <div className="h-2 bg-muted rounded">
                <div
                  className="h-2 bg-destructive rounded"
                  style={{ width: `${((Number(r.bruto_total) || 0) / maxBruto) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Por empresa */}
      <Card>
        <CardHeader><CardTitle className="text-base">Cancelamentos por empresa</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-right">Grupos</TableHead>
                  <TableHead className="text-right">Itens canc.</TableHead>
                  <TableHead className="text-right">Bruto preservado</TableHead>
                  <TableHead className="text-right">Líquido preservado</TableHead>
                  <TableHead>Motivos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                )}
                {!loading && data.by_company.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem dados.</TableCell></TableRow>
                )}
                {!loading && data.by_company.map((c) => (
                  <TableRow key={c.company_id}>
                    <TableCell className="font-medium">
                      {c.company_name}
                      {c.qtd_reativados > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">{c.qtd_reativados} reativ.</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{c.qtd_grupos}</TableCell>
                    <TableCell className="text-right">{c.itens_cancelados ?? 0}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(c.bruto_total)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.liquido_total)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(c.motivos ?? []).map(reasonLabel).join(" / ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Por pagamento (drill-down) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cancelamentos por pagamento ({data.by_payment.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <Skeleton className="h-5 w-full" />}
          {!loading && data.by_payment.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Sem pagamentos com cancelamentos.</p>
          )}
          {!loading && data.by_payment.map((p) => (
            <Collapsible key={p.payment_id}>
              <div className="border rounded-lg">
                <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-muted/40 transition-colors group">
                  <div className="flex items-center gap-2 text-left">
                    <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                    <div>
                      <div className="font-medium text-sm">
                        {p.competencia ?? p.reference_month ?? "—"}
                        <span className="text-xs text-muted-foreground ml-2 font-mono">#{p.payment_id.slice(0, 8)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.grupos_afetados} grupo(s) · {p.itens_cancelados ?? 0} itens · {(p.motivos ?? []).map(reasonLabel).join(" / ")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <div className="text-xs text-muted-foreground">Bruto preservado</div>
                      <div className="font-semibold">{formatCurrency(p.bruto_total)}</div>
                    </div>
                    <Button asChild size="sm" variant="ghost" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/pagamentos/${p.payment_id}`}>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead>Motivo / Observação</TableHead>
                          <TableHead>Autor</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Bruto</TableHead>
                          <TableHead className="text-right">Líquido</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.grupos.map((g) => (
                          <TableRow key={g.group_id}>
                            <TableCell className="font-medium text-sm">
                              {g.company_name}
                              <div className="text-xs text-muted-foreground">{g.items_cancelados} item(ns) cancelado(s)</div>
                            </TableCell>
                            <TableCell className="text-sm">
                              <div>{reasonLabel(g.reason ?? "")}</div>
                              {g.note && <div className="text-xs text-muted-foreground italic">{g.note}</div>}
                            </TableCell>
                            <TableCell className="text-xs">{g.autor ?? "—"}</TableCell>
                            <TableCell className="text-xs">{new Date(g.cancelled_at).toLocaleString("pt-BR")}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(g.bruto_total)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(g.liquido_total)}</TableCell>
                            <TableCell>
                              {g.reactivated ? (
                                <Badge variant="secondary">Reativado</Badge>
                              ) : (
                                <Badge variant="outline" className="text-destructive border-destructive/40">Cancelado</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, loading, highlight }: { label: string; value: string; loading?: boolean; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-destructive/40" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="h-7 w-32 mt-2" /> : (
          <div className={`text-xl font-semibold mt-1 ${highlight ? "text-destructive" : ""}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
