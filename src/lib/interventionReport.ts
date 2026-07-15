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
import {
  classifyItem,
  roleLabel,
  type InterventionItem,
  type InterventionSummary,
} from "@/lib/interventionSavings";

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
  economia: "Economia",
  aumento: "Perda",
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

export function exportInterventionExcel(ctx: InterventionReportContext): void {
  const wb = XLSX.utils.book_new();
  const generatedAt = ctx.generatedAt ?? new Date();

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

  const rows: any[][] = [];
  rows.push([{ v: "Rede D'Or — Exacta", s: whiteBold }, null, null, null, null, null, null, null, null, null, null]);
  rows.push([{ v: "Ajustes por intervenção", s: whiteBold }, null, null, null, null, null, null, null, null, null, null]);
  rows.push([]);
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
  ]);
  rows.push([]);
  rows.push([
    { v: "Economia", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: ECON_HEX } } } },
    { v: ctx.summary.economia, s: { ...metaValue, numFmt: 'R$ #,##0.00' } },
    null,
    { v: "Perda", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: PERDA_HEX } } } },
    { v: ctx.summary.perda, s: { ...metaValue, numFmt: 'R$ #,##0.00' } },
    null,
    { v: "Neutro (operacional)", s: { ...metaLabel, fill: { patternType: "solid", fgColor: { rgb: NEUTRO_HEX } } } },
    { v: ctx.summary.neutro, s: { ...metaValue, numFmt: 'R$ #,##0.00' } },
    null,
    { v: "Saldo líquido", s: metaLabel },
    { v: ctx.summary.saldo, s: { ...metaValue, numFmt: 'R$ #,##0.00', font: { bold: true, sz: 10 } } },
  ]);
  rows.push([]);

  const headers = [
    "Data",
    "Autor",
    "Papel",
    "Empresa",
    "Médico",
    "Procedimento",
    "Valor regra (R$)",
    "Pago final (R$)",
    "Δ (R$)",
    "Classificação",
  ];
  rows.push(headers.map((h) => ({ v: h, s: headerCell })));

  const currencyFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  ctx.items.forEach((it) => {
    const cls = classifyItem(it);
    const rowFill =
      cls === "economia"
        ? { patternType: "solid" as const, fgColor: { rgb: ECON_HEX } }
        : cls === "aumento"
        ? { patternType: "solid" as const, fgColor: { rgb: PERDA_HEX } }
        : { patternType: "solid" as const, fgColor: { rgb: "FFFFFF" } };
    const base = { fill: rowFill, font: { sz: 10, name: "Calibri" } };
    rows.push([
      { v: fmtDatePt(it.obs_at), s: base },
      { v: it.autor ?? "—", s: base },
      { v: roleLabel(it.role), s: base },
      { v: it.company_name ?? "—", s: base },
      { v: it.doctor_name ?? "—", s: base },
      { v: [it.procedure_code, it.procedure_name].filter(Boolean).join(" — ") || "—", s: base },
      { v: Number(it.valor_regra) || 0, s: { ...base, numFmt: currencyFmt, alignment: { horizontal: "right" } } },
      { v: Number(it.valor_pago_final) || 0, s: { ...base, numFmt: currencyFmt, alignment: { horizontal: "right" } } },
      {
        v: Number(it.delta) || 0,
        s: {
          ...base,
          numFmt: currencyFmt,
          alignment: { horizontal: "right" },
          font: { sz: 10, bold: true, name: "Calibri" },
        },
      },
      { v: classificationLabel[cls], s: { ...base, alignment: { horizontal: "center" } } },
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 20 },
    { wch: 28 },
    { wch: 26 },
    { wch: 42 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];
  ws["!rows"] = [{ hpt: 22 }, { hpt: 20 }];
  // Congelar cabeçalho da tabela
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 8 };

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
    { label: "Economia", value: formatCurrency(ctx.summary.economia), rgb: [231, 245, 236] },
    { label: "Perda", value: formatCurrency(ctx.summary.perda), rgb: [253, 236, 236] },
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
