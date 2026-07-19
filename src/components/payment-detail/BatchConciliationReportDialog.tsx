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
import { Download, FileDown, RefreshCw, AlertTriangle, ChevronRight, Search, X, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";
import { PJDrilldownDialog } from "./PJDrilldownDialog";

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
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState("");
  type SortKey = "company_name" | "nf_expected" | "nf_received" | "grp_bruto" | "grp_liquido" | "snap_bruto" | "snap_glosas" | "snap_liquido" | "app_confirmado" | "app_proposto" | "app_pending" | "app_postponed";
  const [sortKey, setSortKey] = useState<SortKey>("company_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [patternInfo, setPatternInfo] = useState<
    | { label: string; avg: number | null; monthsSeen: number; currentBruto: number; deltaPct: number | null }
    | null
  >(null);

  useEffect(() => {
    if (!open || !paymentId) { setPatternInfo(null); return; }
    let cancelled = false;
    (async () => {
      const { data: py } = await supabase
        .from("payments")
        .select("batch_pattern_id, bruto_total")
        .eq("id", paymentId)
        .maybeSingle();
      const patternId = (py as { batch_pattern_id?: string | null } | null)?.batch_pattern_id ?? null;
      const currentBruto = Number((py as { bruto_total?: number | null } | null)?.bruto_total ?? 0);
      if (!patternId) { if (!cancelled) setPatternInfo(null); return; }
      const { data } = await supabase.rpc("get_pattern_stats" as never, { p_pattern_id: patternId } as never);
      if (cancelled) return;
      const row = (((data ?? []) as Array<{ label: string; avg_bruto: number | null; months_seen: number }>) ?? [])[0];
      if (!row) { setPatternInfo(null); return; }
      const avg = row.avg_bruto != null ? Number(row.avg_bruto) : null;
      const deltaPct = avg && avg > 0 ? ((currentBruto - avg) / avg) * 100 : null;
      setPatternInfo({ label: row.label, avg, monthsSeen: Number(row.months_seen), currentBruto, deltaPct });
    })();
    return () => { cancelled = true; };
  }, [open, paymentId]);


  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "company_name" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ k, label, align = "right", title, className }: { k: SortKey; label: string; align?: "left" | "right"; title?: string; className?: string }) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className={cn("p-2 border-b select-none", align === "right" ? "text-right" : "text-left", className)} title={title}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground transition-colors",
            align === "right" && "flex-row-reverse",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <Icon className="h-3 w-3" />
          <span>{label}</span>
        </button>
      </th>
    );
  };

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.company_name.toLowerCase().includes(q)) : rows.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortKey === "company_name") return a.company_name.localeCompare(b.company_name, "pt-BR") * dir;
      const av = (a[sortKey] as number | null) ?? 0;
      const bv = (b[sortKey] as number | null) ?? 0;
      return (av - bv) * dir;
    });
    return filtered;
  }, [rows, filter, sortKey, sortDir]);

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
    return visibleRows.reduce(
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
  }, [visibleRows]);

  type Flag = { label: string; tone: "info" | "warn" };
  const flagRow = (r: Row): Flag[] => {
    const flags: Flag[] = [];
    // Deduções aplicadas — intencionais, apenas informativas
    if (r.snap_glosas > 0.01) flags.push({ label: "glosa aplicada", tone: "info" });
    if (r.snap_debitos > 0.01) flags.push({ label: "débito aplicado", tone: "info" });
    if (r.snap_creditos > 0.01) flags.push({ label: "crédito aplicado", tone: "info" });

    // Inconsistências reais — merecem atenção
    const glosaPendenteConfirmar = r.snap_glosas - r.app_confirmado;
    if (glosaPendenteConfirmar > 0.01) flags.push({ label: "glosa a confirmar", tone: "warn" });
    if (r.app_pending > 0.01) flags.push({ label: "pendências manuais", tone: "warn" });
    if (r.nf_expected > 0 && Math.abs(r.nf_expected - r.snap_liquido) > 0.01)
      flags.push({ label: "NF ≠ líquido", tone: "warn" });

    // Bruto divergente sem explicação (não é glosa/débito/crédito)
    const brutoDiff = r.grp_bruto - r.snap_bruto;
    if (Math.abs(brutoDiff) > 0.01) flags.push({ label: "bruto recalculado", tone: "warn" });
    return flags;
  };
  const hasWarn = (r: Row) => flagRow(r).some((f) => f.tone === "warn");

  const exportXlsx = () => {
    const header = [
      "PJ",
      "Bruto (grupo)",
      "Apurado bruto",
      "(−) Glosas",
      "Confirmado",
      "Proposto",
      "Pendente",
      "Adiado",
      "Apurado líquido",
      "Líquido (grupo)",
      "NF esperada",
      "NF recebida",
      "Qtd NF",
      "Apurado débitos",
      "Apurado créditos",
      "Observações",
    ];
    const body = visibleRows.map((r) => [
      r.company_name,
      r.grp_bruto,
      r.snap_bruto,
      r.snap_glosas,
      r.app_confirmado,
      r.app_proposto,
      r.app_pending,
      r.app_postponed,
      r.snap_liquido,
      r.grp_liquido,
      r.nf_expected,
      r.nf_received,
      r.nf_count,
      r.snap_debitos,
      r.snap_creditos,
      flagRow(r).map((f) => f.label).join(" · "),
    ]);
    const totalRow = [
      "TOTAL",
      totals.grp_bruto,
      totals.snap_bruto,
      totals.snap_glosas,
      totals.app_confirmado,
      totals.app_proposto,
      totals.app_pending,
      totals.app_postponed,
      totals.snap_liquido,
      totals.grp_liquido,
      totals.nf_expected,
      totals.nf_received,
      visibleRows.reduce((a, r) => a + r.nf_count, 0),
      totals.snap_debitos,
      totals.snap_creditos,
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
    const numCols = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14];
    for (let r = 1; r <= body.length + 1; r++) {
      for (const c of numCols) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) (ws[addr] as any).z = '"R$" #,##0.00;[Red]"R$" -#,##0.00';
      }
    }
    ws["!cols"] = header.map((h, i) => ({ wch: i === 0 ? 42 : i === header.length - 1 ? 40 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliação PJ");
    XLSX.writeFile(wb, `conciliacao-lote-${paymentReference ?? paymentId.slice(0, 8)}.xlsx`);
  };

  const exportPdf = async () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const startY = await drawReportHeader(doc, {
      title: "Panorama do lote — conciliação financeira por PJ",
      subtitle: `Lote ${paymentReference ?? paymentId.slice(0, 8)} · ${visibleRows.length} PJs${filter.trim() ? ` (filtro: "${filter.trim()}")` : ""} · gerado em ${new Date().toLocaleString("pt-BR")}`,
      filledBar: true,
    });

    const fmt = (n: number | null) =>
      n === null || n === undefined
        ? "—"
        : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const head = [[
      "PJ",
      "Bruto grupo",
      "Apurado bruto",
      "(−) Glosas",
      "Confirm.",
      "Proposto",
      "Pendente",
      "Adiado",
      "Apurado líq.",
      "Líq. grupo",
      "NF esp.",
      "NF receb.",
      "Observações",
    ]];

    const body = visibleRows.map((r) => {
      const flags = flagRow(r);
      return [
        r.company_name,
        fmt(r.grp_bruto),
        fmt(r.snap_bruto),
        fmt(r.snap_glosas),
        fmt(r.app_confirmado),
        fmt(r.app_proposto),
        fmt(r.app_pending),
        fmt(r.app_postponed),
        fmt(r.snap_liquido),
        fmt(r.grp_liquido),
        fmt(r.nf_expected),
        fmt(r.nf_received),
        flags.length ? flags.map((f) => f.label).join(" · ") : "conforme",
      ];
    });

    const foot = [[
      `TOTAL (${visibleRows.length})`,
      fmt(totals.grp_bruto),
      fmt(totals.snap_bruto),
      fmt(totals.snap_glosas),
      fmt(totals.app_confirmado),
      fmt(totals.app_proposto),
      fmt(totals.app_pending),
      fmt(totals.app_postponed),
      fmt(totals.snap_liquido),
      fmt(totals.grp_liquido),
      fmt(totals.nf_expected),
      fmt(totals.nf_received),
      "",
    ]];

    autoTable(doc, {
      startY: startY + 4,
      head,
      body,
      foot,
      styles: { fontSize: 7.2, cellPadding: 1.6, overflow: "linebreak", valign: "middle" },
      headStyles: {
        fillColor: REDE_DOR_BRAND_BLUE_RGB as any,
        textColor: 255,
        fontStyle: "bold",
        halign: "center",
      },
      footStyles: { fillColor: [230, 235, 245], textColor: 20, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 52, halign: "left", fontStyle: "bold" },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right", textColor: [178, 34, 34] },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right", fontStyle: "bold" },
        9: { halign: "right" },
        10: { halign: "right" },
        11: { halign: "right" },
        12: { cellWidth: 45, fontSize: 6.6 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === "body") {
          const r = visibleRows[data.row.index];
          const hasWarnFlag = r ? flagRow(r).some((f) => f.tone === "warn") : false;
          if (hasWarnFlag) {
            data.cell.styles.fillColor = [255, 249, 219];
          }
          if (data.column.index === 12 && data.cell.raw && data.cell.raw !== "conforme") {
            data.cell.styles.textColor = hasWarnFlag ? [161, 98, 7] : [100, 116, 139];
            data.cell.styles.fontStyle = hasWarnFlag ? "bold" : "normal";
          }
        }
      },
      margin: { left: 8, right: 8 },
      didDrawPage: () => {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        const pageStr = `Página ${doc.getCurrentPageInfo().pageNumber}`;
        doc.text(pageStr, pageWidth - 8, pageHeight - 5, { align: "right" });
        doc.text("Fonte: pedido de nota + valor apurado do lote + aplicações de glosa", 8, pageHeight - 5);
      },
    });

    doc.save(`panorama-lote-${paymentReference ?? paymentId.slice(0, 8)}.pdf`);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,96vw)] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Panorama do lote — comparativo financeiro por PJ</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Compara <strong>pedido de nota</strong> (NF), <strong>valor apurado</strong> pelo sistema e{" "}
            <strong>glosas efetivamente aplicadas</strong> por status. Não confundir com a conciliação de produção (base hospital × Exacta).
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Apurado</strong> = valor consolidado do lote após regras, glosas, débitos e créditos —
            é o que o sistema calcula que a PJ deve receber. <strong>Grupo</strong> = totais brutos vindos da produção antes de glosas.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 px-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar PJ pelo nome…"
              className="h-8 pl-7 pr-7 text-xs"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar filtro"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {filter.trim() && (
            <span className="text-xs text-muted-foreground">
              {visibleRows.length} de {rows.length} PJs
            </span>
          )}
        </div>



        <div className="flex-1 overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
              <tr className="text-left">
                <th className="p-2 border-b w-8"></th>
                <SortHeader k="company_name" label="PJ" align="left" />
                <SortHeader k="grp_bruto" label="Bruto (grupo)" title="Total bruto vindo da produção, antes de qualquer dedução" />
                <SortHeader k="snap_bruto" label="Apurado bruto" title="Bruto apurado pelo sistema após regras" />
                <SortHeader k="snap_glosas" label="(−) Glosas" title="Total de glosas apuradas para esta PJ no lote" />
                <SortHeader k="app_confirmado" label="Confirmado" title="Glosas efetivamente lançadas no pagamento" />
                <SortHeader k="app_proposto" label="Proposto" title="Sugestões pendentes de confirmação em Créditos & Débitos" />
                <SortHeader k="app_pending" label="Pendente" title="Pendências manuais aguardando resolução" />
                <SortHeader k="app_postponed" label="Adiado" title="Aplicações adiadas para o próximo ciclo" />
                <SortHeader k="snap_liquido" label="Apurado líquido" title="Valor líquido apurado (Bruto − Glosas − Débitos + Créditos)" />
                <SortHeader k="grp_liquido" label="Líquido (grupo)" title="Líquido derivado dos totais brutos do grupo" />
                <SortHeader k="nf_expected" label="NF esperada" title="Valor esperado no pedido de nota" />
                <SortHeader k="nf_received" label="NF recebida" title="Valor efetivamente recebido nas notas" />
                <th className="p-2 border-b font-medium text-muted-foreground normal-case">Observações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">
                    Nenhuma PJ neste lote.
                  </td>
                </tr>
              )}
              {!loading && rows.length > 0 && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">
                    Nenhuma PJ corresponde ao filtro "{filter}".
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r) => {
                  const flags = flagRow(r);
                  const warn = flags.some((f) => f.tone === "warn");
                  return (
                    <tr
                      key={r.company_id}
                      onClick={() => setDrill({ id: r.company_id, name: r.company_name })}
                      className={cn(
                        "border-b hover:bg-muted/50 cursor-pointer",
                        warn && "bg-warning-soft/30",
                      )}
                      title="Ver detalhamento linha a linha"
                    >
                      <td className="p-2 text-muted-foreground"><ChevronRight className="h-3.5 w-3.5" /></td>
                      <td className="p-2 font-medium underline-offset-2 hover:underline">{r.company_name}</td>
                      <td className="p-2 text-right">{formatCurrency(r.grp_bruto)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.snap_bruto)}</td>
                      <td className="p-2 text-right text-destructive">{formatCurrency(r.snap_glosas)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_confirmado)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_proposto)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_pending)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.app_postponed)}</td>
                      <td className="p-2 text-right font-medium">{formatCurrency(r.snap_liquido)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.grp_liquido)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.nf_expected)}</td>
                      <td className="p-2 text-right">{r.nf_received === null ? "—" : formatCurrency(r.nf_received)}</td>
                      <td className="p-2">
                        {flags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {flags.map((f) => (
                              <Badge
                                key={f.label}
                                variant="outline"
                                className={cn(
                                  "gap-1",
                                  f.tone === "warn"
                                    ? "border-warning/60 text-warning"
                                    : "border-muted-foreground/30 text-muted-foreground",
                                )}
                              >
                                {f.tone === "warn" && <AlertTriangle className="h-3 w-3" />} {f.label}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-success/60 text-success">
                            conforme
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {!loading && visibleRows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-muted/90 font-semibold">
                <tr>
                  <td className="p-2" />
                  <td className="p-2">TOTAL ({visibleRows.length}{filter.trim() ? ` de ${rows.length}` : ""})</td>
                  <td className="p-2 text-right">{formatCurrency(totals.grp_bruto)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.snap_bruto)}</td>
                  <td className="p-2 text-right text-destructive">{formatCurrency(totals.snap_glosas)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_confirmado)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_proposto)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_pending)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.app_postponed)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.snap_liquido)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.grp_liquido)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.nf_expected)}</td>
                  <td className="p-2 text-right">{formatCurrency(totals.nf_received)}</td>
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
          <Button variant="outline" onClick={exportPdf} disabled={loading || rows.length === 0}>
            <FileDown className="h-4 w-4 mr-1.5" /> Exportar PDF
          </Button>
          <Button onClick={exportXlsx} disabled={loading || rows.length === 0}>
            <Download className="h-4 w-4 mr-1.5" /> Exportar XLSX
          </Button>
        </DialogFooter>
      </DialogContent>
      {drill && (
        <PJDrilldownDialog
          open={!!drill}
          onOpenChange={(v) => !v && setDrill(null)}
          paymentId={paymentId}
          companyId={drill.id}
          companyName={drill.name}
        />
      )}
    </Dialog>
  );
}
