import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import { toast } from "@/hooks/use-toast";
import { Download, FileDown, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  paymentReference?: string | null;
};

type Row = {
  company_id: string;
  company_name: string;
  // pedido de nota (invoices)
  nf_expected: number;
  nf_received: number | null;
  nf_status: string | null;
  nf_count: number;
  // snapshot financeiro (payment_company_financials)
  snap_bruto: number;
  snap_glosas: number;
  snap_debitos: number;
  snap_creditos: number;
  snap_liquido: number;
  // aplicações efetivas (glosa_payment_applications)
  app_confirmado: number;
  app_proposto: number;
  app_pending: number;
  app_postponed: number;
  app_partial: number;
  // grupo (para bruto de referência)
  grp_bruto: number;
  grp_liquido: number;
};

const APP_STATUSES = ["confirmado", "proposto", "pending_manual_resolution", "postponed", "partial"] as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function BatchConciliationReportDialog({ open, onOpenChange, paymentId, paymentReference }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [groupsRes, snapRes, invRes, appsRes] = await Promise.all([
        supabase
          .from("payment_company_groups")
          .select("company_id, company_name, bruto_total, liquido_total")
          .eq("payment_id", paymentId),
        supabase
          .from("payment_company_financials")
          .select("company_id, bruto, glosas, debitos, creditos, liquido")
          .eq("payment_id", paymentId),
        supabase
          .from("invoices")
          .select("company_id, expected_amount, received_amount, status")
          .eq("payment_id", paymentId)
          .neq("status", "cancelada"),
        supabase
          .from("glosa_payment_applications")
          .select("company_id, status, valor_aplicado")
          .eq("payment_id", paymentId),
      ]);

      if (groupsRes.error) throw groupsRes.error;
      if (snapRes.error) throw snapRes.error;
      if (invRes.error) throw invRes.error;
      if (appsRes.error) throw appsRes.error;

      const byCompany = new Map<string, Row>();
      const ensure = (id: string | null, name?: string | null): Row | null => {
        if (!id) return null;
        let r = byCompany.get(id);
        if (!r) {
          r = {
            company_id: id,
            company_name: name || "—",
            nf_expected: 0,
            nf_received: null,
            nf_status: null,
            nf_count: 0,
            snap_bruto: 0,
            snap_glosas: 0,
            snap_debitos: 0,
            snap_creditos: 0,
            snap_liquido: 0,
            app_confirmado: 0,
            app_proposto: 0,
            app_pending: 0,
            app_postponed: 0,
            app_partial: 0,
            grp_bruto: 0,
            grp_liquido: 0,
          };
          byCompany.set(id, r);
        } else if (name && r.company_name === "—") {
          r.company_name = name;
        }
        return r;
      };

      for (const g of groupsRes.data || []) {
        const r = ensure(g.company_id, g.company_name);
        if (!r) continue;
        r.grp_bruto += Number(g.bruto_total || 0);
        r.grp_liquido += Number(g.liquido_total || 0);
      }
      for (const s of snapRes.data || []) {
        const r = ensure(s.company_id);
        if (!r) continue;
        r.snap_bruto += Number(s.bruto || 0);
        r.snap_glosas += Number(s.glosas || 0);
        r.snap_debitos += Number(s.debitos || 0);
        r.snap_creditos += Number(s.creditos || 0);
        r.snap_liquido += Number(s.liquido || 0);
      }
      for (const inv of invRes.data || []) {
        const r = ensure(inv.company_id);
        if (!r) continue;
        r.nf_expected += Number(inv.expected_amount || 0);
        r.nf_received = (r.nf_received ?? 0) + Number(inv.received_amount || 0);
        r.nf_status = inv.status ?? r.nf_status;
        r.nf_count += 1;
      }
      for (const a of appsRes.data || []) {
        const r = ensure(a.company_id);
        if (!r) continue;
        const v = Number(a.valor_aplicado || 0);
        if (a.status === "confirmado") r.app_confirmado += v;
        else if (a.status === "proposto") r.app_proposto += v;
        else if (a.status === "pending_manual_resolution") r.app_pending += v;
        else if (a.status === "postponed") r.app_postponed += v;
        else if (a.status === "partial") r.app_partial += v;
      }

      const arr = Array.from(byCompany.values())
        .map((r) => ({
          ...r,
          nf_expected: round2(r.nf_expected),
          nf_received: r.nf_received === null ? null : round2(r.nf_received),
          snap_bruto: round2(r.snap_bruto),
          snap_glosas: round2(r.snap_glosas),
          snap_debitos: round2(r.snap_debitos),
          snap_creditos: round2(r.snap_creditos),
          snap_liquido: round2(r.snap_liquido),
          app_confirmado: round2(r.app_confirmado),
          app_proposto: round2(r.app_proposto),
          app_pending: round2(r.app_pending),
          app_postponed: round2(r.app_postponed),
          app_partial: round2(r.app_partial),
          grp_bruto: round2(r.grp_bruto),
          grp_liquido: round2(r.grp_liquido),
        }))
        .sort((a, b) => a.company_name.localeCompare(b.company_name, "pt-BR"));
      setRows(arr);
    } catch (e: any) {
      console.error(e);
      toast({ title: "Falha ao carregar conciliação", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.nf_expected += r.nf_expected;
        acc.nf_received += r.nf_received || 0;
        acc.snap_bruto += r.snap_bruto;
        acc.snap_glosas += r.snap_glosas;
        acc.snap_debitos += r.snap_debitos;
        acc.snap_creditos += r.snap_creditos;
        acc.snap_liquido += r.snap_liquido;
        acc.app_confirmado += r.app_confirmado;
        acc.app_proposto += r.app_proposto;
        acc.app_pending += r.app_pending;
        acc.app_postponed += r.app_postponed;
        acc.app_partial += r.app_partial;
        acc.grp_bruto += r.grp_bruto;
        acc.grp_liquido += r.grp_liquido;
        return acc;
      },
      {
        nf_expected: 0,
        nf_received: 0,
        snap_bruto: 0,
        snap_glosas: 0,
        snap_debitos: 0,
        snap_creditos: 0,
        snap_liquido: 0,
        app_confirmado: 0,
        app_proposto: 0,
        app_pending: 0,
        app_postponed: 0,
        app_partial: 0,
        grp_bruto: 0,
        grp_liquido: 0,
      },
    );
  }, [rows]);

  const flagRow = (r: Row) => {
    const flags: string[] = [];
    if (Math.abs(r.grp_bruto - r.snap_bruto) > 0.01) flags.push("bruto grupo ≠ snapshot");
    if (Math.abs(r.grp_liquido - r.snap_liquido) > 0.01) flags.push("líquido grupo ≠ snapshot");
    if (Math.abs(r.snap_glosas - r.app_confirmado) > 0.01) flags.push("glosa snapshot ≠ confirmado");
    if (r.nf_expected > 0 && Math.abs(r.nf_expected - r.snap_liquido) > 0.01)
      flags.push("NF esperada ≠ líquido");
    if (r.app_pending > 0) flags.push("pendências sem resolução");
    return flags;
  };

  const exportXlsx = () => {
    const header = [
      "PJ",
      "NF esperada",
      "NF recebida",
      "Qtd NF",
      "Bruto grupo",
      "Líquido grupo",
      "Snap bruto",
      "Snap glosas",
      "Snap débitos",
      "Snap créditos",
      "Snap líquido",
      "App confirmado",
      "App proposto",
      "App pending",
      "App postponed",
      "App partial",
      "Divergências",
    ];
    const body = rows.map((r) => [
      r.company_name,
      r.nf_expected,
      r.nf_received,
      r.nf_count,
      r.grp_bruto,
      r.grp_liquido,
      r.snap_bruto,
      r.snap_glosas,
      r.snap_debitos,
      r.snap_creditos,
      r.snap_liquido,
      r.app_confirmado,
      r.app_proposto,
      r.app_pending,
      r.app_postponed,
      r.app_partial,
      flagRow(r).join(" · "),
    ]);
    const totalRow = [
      "TOTAL",
      totals.nf_expected,
      totals.nf_received,
      rows.reduce((a, r) => a + r.nf_count, 0),
      totals.grp_bruto,
      totals.grp_liquido,
      totals.snap_bruto,
      totals.snap_glosas,
      totals.snap_debitos,
      totals.snap_creditos,
      totals.snap_liquido,
      totals.app_confirmado,
      totals.app_proposto,
      totals.app_pending,
      totals.app_postponed,
      totals.app_partial,
      "",
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
    const headStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1F3A8A" } },
      alignment: { horizontal: "center" },
    };
    for (let c = 0; c < header.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      (ws[addr] as any).s = headStyle;
    }
    const numCols = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    for (let r = 1; r <= body.length + 1; r++) {
      for (const c of numCols) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) (ws[addr] as any).z = '"R$" #,##0.00;[Red]"R$" -#,##0.00';
      }
    }
    ws["!cols"] = header.map((h, i) => ({ wch: i === 0 ? 42 : i === 16 ? 40 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliação PJ");
    XLSX.writeFile(wb, `conciliacao-lote-${paymentReference ?? paymentId.slice(0, 8)}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,96vw)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Panorama do lote — comparativo financeiro por PJ</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Compara <strong>pedido de nota</strong> (NF), <strong>snapshot financeiro</strong> e{" "}
            <strong>glosas efetivamente aplicadas</strong> por status. Não confundir com a conciliação de produção (base hospital × Exacta).
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
              <tr className="text-left">
                <th className="p-2 border-b">PJ</th>
                <th className="p-2 border-b text-right">NF esperada</th>
                <th className="p-2 border-b text-right">NF recebida</th>
                <th className="p-2 border-b text-right">Bruto (grupo)</th>
                <th className="p-2 border-b text-right">Líquido (grupo)</th>
                <th className="p-2 border-b text-right">Snap bruto</th>
                <th className="p-2 border-b text-right">Snap glosas</th>
                <th className="p-2 border-b text-right">Snap líquido</th>
                <th className="p-2 border-b text-right">Confirmado</th>
                <th className="p-2 border-b text-right">Proposto</th>
                <th className="p-2 border-b text-right">Pending</th>
                <th className="p-2 border-b text-right">Postponed</th>
                <th className="p-2 border-b">Divergências</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-muted-foreground">
                    Nenhuma PJ neste lote.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => {
                  const flags = flagRow(r);
                  return (
                    <tr key={r.company_id} className={cn("border-b hover:bg-muted/30", flags.length && "bg-warning-soft/30")}>
                      <td className="p-2 font-medium">{r.company_name}</td>
                      <td className="p-2 text-right">{formatCurrency(r.nf_expected)}</td>
                      <td className="p-2 text-right">{r.nf_received === null ? "—" : formatCurrency(r.nf_received)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.grp_bruto)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.grp_liquido)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.snap_bruto)}</td>
                      <td className="p-2 text-right text-destructive">{formatCurrency(r.snap_glosas)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.snap_liquido)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_confirmado)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_proposto)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_pending)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_postponed)}</td>
                      <td className="p-2">
                        {flags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {flags.map((f) => (
                              <Badge key={f} variant="outline" className="border-warning/60 text-warning gap-1">
                                <AlertTriangle className="h-3 w-3" /> {f}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-success/60 text-success">
                            ok
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-muted/90 font-semibold">
                <tr>
                  <td className="p-2">TOTAL ({rows.length})</td>
                  <td className="p-2 text-right">{formatCurrency(totals.nf_expected)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.nf_received)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.grp_bruto)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.grp_liquido)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.snap_bruto)}</td>
                  <td className="p-2 text-right text-destructive">{formatCurrency(totals.snap_glosas)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.snap_liquido)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_confirmado)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_proposto)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_pending)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_postponed)}</td>
                  <td className="p-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} /> Recarregar
          </Button>
          <Button onClick={exportXlsx} disabled={loading || rows.length === 0}>
            <Download className="h-4 w-4 mr-1.5" /> Exportar XLSX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
