/**
 * Exportadores do relatório "Ajustes por intervenção".
 *
 * - Excel formatado (xlsx-js-style): cabeçalho institucional, KPIs, colunas
 *   com larguras adequadas, valores em R$ formatados e cores por classificação.
 * - PDF Rede D'Or (jsPDF + autotable): faixa institucional azul, logo,
 *   KPIs consolidados e tabela paginada.
 */
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";
import { formatCurrency } from "@/lib/status";
import { supabase } from "@/integrations/supabase/client";
import {
  classifyItem,
  roleLabel,
  type InterventionItem,
  type InterventionSummary,
} from "@/lib/interventionSavings";

/**
 * Busca rótulo do lote (payments.reference + competence_month) e attendance_number
 * dos itens para enriquecer o export — evita "duplicatas visuais" no arquivo quando
 * o mesmo procedimento aparece em atendimentos/lotes distintos.
 *
 * Escopo: SOMENTE leitura auxiliar do exportador. Não altera RPC nem KPIs.
 */
type Enrichment = {
  loteByPayment: Map<string, string>;
  attendanceByItem: Map<string, string>;
};

const monthLabelPt = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
};

async function fetchEnrichment(items: InterventionItem[]): Promise<Enrichment> {
  const loteByPayment = new Map<string, string>();
  const attendanceByItem = new Map<string, string>();
  const paymentIds = Array.from(new Set(items.map((i) => i.payment_id).filter(Boolean)));
  const itemIds = Array.from(new Set(items.map((i) => i.item_id).filter(Boolean)));

  try {
    if (paymentIds.length > 0) {
      const { data } = await supabase
        .from("payments")
        .select("id, reference, competence_month")
        .in("id", paymentIds);
      (data ?? []).forEach((p: any) => {
        const ref = p.reference ?? "";
        const comp = monthLabelPt(p.competence_month);
        loteByPayment.set(p.id, [ref, comp].filter(Boolean).join(" · "));
      });
    }
  } catch { /* enrichment é best-effort */ }

  try {
    if (itemIds.length > 0) {
      // chunk para evitar URL gigante
      const chunkSize = 500;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const slice = itemIds.slice(i, i + chunkSize);
        const { data } = await supabase
          .from("payment_items")
          .select("id, attendance_number")
          .in("id", slice);
        (data ?? []).forEach((r: any) => {
          if (r.attendance_number) attendanceByItem.set(r.id, String(r.attendance_number));
        });
      }
    }
  } catch { /* itens de glosa_pj não existem em payment_items — ok */ }

  return { loteByPayment, attendanceByItem };
}

const BRAND_HEX = "01498E";
const ECON_HEX = "E7F5EC";
const PERDA_HEX = "FDECEC";
const NEUTRO_HEX = "F3F4F6";

const fmtDatePt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const classificationLabel: Record<string, string> = {
  economia: "Valor recuperado",
  aumento: "Valor extra a pagar",
  neutro: "Neutro",
};

export interface InterventionReportContext {
  hospitalName?: string | null;
  rangeDays: number;
  summary: InterventionSummary;
  items: InterventionItem[];
  generatedAt?: Date;
}

/* ==================== EXCEL ==================== */

export async function exportInterventionExcel(ctx: InterventionReportContext): Promise<void> {
  const wb = XLSX.utils.book_new();
  const generatedAt = ctx.generatedAt ?? new Date();
  const { loteByPayment, attendanceByItem } = await fetchEnrichment(ctx.items);

  const brandFill = { patternType: "solid" as const, fgColor: { rgb: BRAND_HEX } };
  const whiteBold = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12, name: "Calibri" },
    fill: brandFill,
    alignment: { vertical: "center" as const, horizontal: "left" as const },
  };
  const headerCell = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11, name: "Calibri" },
    fill: brandFill,
    alignment: { vertical: "center" as const, horizontal: "center" as const, wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "FFFFFF" } },
      bottom: { style: "thin", color: { rgb: "FFFFFF" } },
      left: { style: "thin", color: { rgb: "FFFFFF" } },
      right: { style: "thin", color: { rgb: "FFFFFF" } },
    },
  };
  const metaLabel = { font: { bold: true, sz: 10, color: { rgb: "374151" } } };
  const metaValue = { font: { sz: 10, color: { rgb: "111827" } } };

  // Formatos BR nativos (Excel usa locale-id 416 = pt-BR → força vírgula
  // decimal e ponto de milhar, com "R$" prefixado e 2 casas).
  const currencyFmt = '[$R$-416] #,##0.00;[Red]-[$R$-416] #,##0.00;[$R$-416] "-"';
  const dateFmt = 'dd/mm/yyyy';

  const rows: any[][] = [];
  const totalCols = 12;
  const spacerRow = new Array(totalCols).fill(null);
  const titleRow = (label: string) => {
    const r = new Array(totalCols).fill(null);
    r[0] = { v: label, s: whiteBold };
    return r;
  };
  rows.push(titleRow("Rede D'Or — Exacta"));
  rows.push(titleRow("Ajustes por intervenção"));
  rows.push(spacerRow);
  rows.push([
    { v: "Hospital", s: metaLabel },
    { v: ctx.hospitalName ?? "—", s: metaValue },
    null,
    { v: "Período", s: metaLabel },
    { v: `Últimos ${ctx.rangeDays} dias`, s: metaValue },
    null,
    { v: "Gerado em", s: metaLabel },
    { v: generatedAt.toLocaleString("pt-BR"), s: metaValue },
    null,
    { v: "Total de itens", s: metaLabel },
    { v: ctx.items.length, s: metaValue },
    null,
  ]);
  rows.push(spacerRow);
  rows.push([
    { v: "Valor recuperado", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: ECON_HEX } } } },
    { t: "n", v: Number(ctx.summary.economia) || 0, s: { ...metaValue, numFmt: currencyFmt } },
    null,
    { v: "Valor extra a pagar", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: PERDA_HEX } } } },
    { t: "n", v: Number(ctx.summary.perda) || 0, s: { ...metaValue, numFmt: currencyFmt } },
    null,
    { v: "Neutro (operacional)", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: NEUTRO_HEX } } } },
    { t: "n", v: Number(ctx.summary.neutro) || 0, s: { ...metaValue, numFmt: currencyFmt } },
    null,
    { v: "Saldo líquido", s: metaLabel },
    { t: "n", v: Number(ctx.summary.saldo) || 0, s: { ...metaValue, numFmt: currencyFmt, font: { bold: true, sz: 10 } } },
    null,
  ]);
  rows.push(spacerRow);

  const headers = [
    "Data",
    "Lote",
    "Atendimento",
    "Autor",
    "Papel",
    "Empresa",
    "Médico",
    "Procedimento",
    "Valor regra",
    "Pago final",
    "Δ",
    "Classificação",
  ];
  rows.push(headers.map((h) => ({ v: h, s: headerCell })));

  ctx.items.forEach((it) => {
    const cls = classifyItem(it);
    const rowFill =
      cls === "economia"
        ? { patternType: "solid" as const, fgColor: { rgb: ECON_HEX } }
        : cls === "aumento"
        ? { patternType: "solid" as const, fgColor: { rgb: PERDA_HEX } }
        : { patternType: "solid" as const, fgColor: { rgb: "FFFFFF" } };
    const base = { fill: rowFill, font: { sz: 10, name: "Calibri" } };
    const rightNum = { ...base, numFmt: currencyFmt, alignment: { horizontal: "right" as const } };

    // Data como número serial do Excel (célula 'd')
    const dateObj = it.obs_at ? new Date(it.obs_at) : null;
    const dateCell =
      dateObj && !isNaN(dateObj.getTime())
        ? { t: "d", v: dateObj, s: { ...base, numFmt: dateFmt, alignment: { horizontal: "center" as const } } }
        : { v: "—", s: base };

    rows.push([
      dateCell,
      { v: loteByPayment.get(it.payment_id) ?? "—", s: base },
      { v: attendanceByItem.get(it.item_id) ?? "", s: { ...base, alignment: { horizontal: "center" as const } } },
      { v: it.autor ?? "—", s: base },
      { v: roleLabel(it.role), s: base },
      { v: it.company_name ?? "—", s: base },
      { v: it.doctor_name ?? "—", s: base },
      { v: [it.procedure_code, it.procedure_name].filter(Boolean).join(" — ") || "—", s: base },
      { t: "n", v: Number(it.valor_regra) || 0, s: rightNum },
      { t: "n", v: Number(it.valor_pago_final) || 0, s: rightNum },
      {
        t: "n",
        v: Number(it.delta) || 0,
        s: { ...rightNum, font: { sz: 10, bold: true, name: "Calibri" } },
      },
      { v: classificationLabel[cls], s: { ...base, alignment: { horizontal: "center" as const } } },
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  ws["!cols"] = [
    { wch: 12 }, // Data
    { wch: 22 }, // Lote
    { wch: 16 }, // Atendimento
    { wch: 24 }, // Autor
    { wch: 20 }, // Papel
    { wch: 28 }, // Empresa
    { wch: 26 }, // Médico
    { wch: 42 }, // Procedimento
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
  ];
  ws["!rows"] = [{ hpt: 22 }, { hpt: 20 }];
  // Congela cabeçalhos até a linha de header da tabela (linha 8, 1-indexed)
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 8 };

  // AutoFilter na tabela (permite ordenação nativa por qualquer coluna)
  const lastRow = rows.length - 1;
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: 7, c: 0 },
      { r: lastRow, c: totalCols - 1 },
    ),
  };

  XLSX.utils.book_append_sheet(wb, ws, "Ajustes por intervenção");
  const stamp = generatedAt.toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ajustes-intervencao-${ctx.rangeDays}d-${stamp}.xlsx`);
}

/* ==================== PDF ==================== */

export async function exportInterventionPdf(ctx: InterventionReportContext): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const marginX = 12;
  const generatedAt = ctx.generatedAt ?? new Date();

  const headerBottomY = await drawReportHeader(doc, {
    title: "Ajustes por intervenção",
    subtitle: `${ctx.hospitalName ?? "Hospital —"} · Últimos ${ctx.rangeDays} dias · Gerado em ${generatedAt.toLocaleString("pt-BR")}`,
    marginX,
    logoHeightMm: 11,
    filledBar: true,
  });

  // Bloco de KPIs
  const kpis: { label: string; value: string; rgb: [number, number, number] }[] = [
    { label: "Valor recuperado", value: formatCurrency(ctx.summary.economia), rgb: [231, 245, 236] },
    { label: "Valor extra a pagar", value: formatCurrency(ctx.summary.perda), rgb: [253, 236, 236] },
    { label: "Neutro", value: formatCurrency(ctx.summary.neutro), rgb: [243, 244, 246] },
    { label: "Saldo líquido", value: formatCurrency(ctx.summary.saldo), rgb: [219, 234, 254] },
    { label: "Itens", value: String(ctx.items.length), rgb: [243, 244, 246] },
  ];
  const pageWidth = doc.internal.pageSize.getWidth();
  const kpiGap = 3;
  const kpiW = (pageWidth - marginX * 2 - kpiGap * (kpis.length - 1)) / kpis.length;
  const kpiY = headerBottomY;
  const kpiH = 16;
  kpis.forEach((k, i) => {
    const x = marginX + i * (kpiW + kpiGap);
    doc.setFillColor(...k.rgb);
    doc.roundedRect(x, kpiY, kpiW, kpiH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(k.label, x + 3, kpiY + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text(k.value, x + 3, kpiY + 12);
  });

  const tableStartY = kpiY + kpiH + 4;

  const body = ctx.items.map((it) => {
    const cls = classifyItem(it);
    return [
      fmtDatePt(it.obs_at),
      it.autor ?? "—",
      roleLabel(it.role),
      it.company_name ?? "—",
      it.doctor_name ?? "—",
      [it.procedure_code, it.procedure_name].filter(Boolean).join(" — ") || "—",
      formatCurrency(it.valor_regra),
      formatCurrency(it.valor_pago_final),
      formatCurrency(it.delta),
      classificationLabel[cls],
    ];
  });

  autoTable(doc, {
    head: [[
      "Data", "Autor", "Papel", "Empresa", "Médico", "Procedimento",
      "Valor regra", "Pago final", "Δ", "Classif.",
    ]],
    body,
    startY: tableStartY,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: "linebreak", valign: "middle" },
    headStyles: {
      fillColor: REDE_DOR_BRAND_BLUE_RGB,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 32 },
      2: { cellWidth: 26 },
      3: { cellWidth: 38 },
      4: { cellWidth: 34 },
      5: { cellWidth: "auto" as any },
      6: { cellWidth: 22, halign: "right" },
      7: { cellWidth: 22, halign: "right" },
      8: { cellWidth: 22, halign: "right", fontStyle: "bold" },
      9: { cellWidth: 20, halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const cls = classifyItem(ctx.items[data.row.index]);
      if (data.column.index === 9 || data.column.index === 8) {
        if (cls === "economia") data.cell.styles.textColor = [22, 101, 52];
        else if (cls === "aumento") data.cell.styles.textColor = [153, 27, 27];
      }
    },
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      const pageNum = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `Rede D'Or — Exacta · Ajustes por intervenção · página ${pageNum}`,
        marginX,
        pageHeight - 6,
      );
    },
  });

  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`ajustes-intervencao-${ctx.rangeDays}d-${stamp}.pdf`);
}
