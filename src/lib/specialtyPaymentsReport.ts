/**
 * Exportação do relatório "Pagamentos por especialidade / PJ".
 *
 * Mesmo padrão dos demais relatórios do sistema: Excel (xlsx-js-style) e
 * PDF (jsPDF + autotable) com cabeçalho institucional Rede D'Or.
 *
 * Regra de negócio refletida aqui: especialidade SEMPRE vem do cadastro do
 * médico (doctors.specialties). O campo payment_items.specialty aparece
 * apenas como coluna informativa de auditoria.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx-js-style";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";

export interface SpecialtyReportFilters {
  hospitalName: string;
  periodLabel: string;
  specialtiesLabel: string;
  groupLabel: string;
  doctorLabel: string;
  companyLabel: string;
}

export interface SpecialtyReportKpis {
  bruto: number;
  liquido: number;
  items: number;
  companies: number;
  doctors: number;
  semMedicoBruto: number;
  semMedicoItems: number;
}

export interface SpecialtyReportGroupRow {
  key: string;
  label: string;
  sublabel: string;
  specialties: string;
  items: number;
  bruto: number;
}

export interface SpecialtyReportMonthRow {
  month: string;
  bruto: number;
  items: number;
}

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function filterLines(f: SpecialtyReportFilters): string[] {
  return [
    `Unidade: ${f.hospitalName}`,
    `Período: ${f.periodLabel}`,
    `Especialidades: ${f.specialtiesLabel}`,
    `Grupo de análise: ${f.groupLabel}`,
    `Médico: ${f.doctorLabel}`,
    `PJ: ${f.companyLabel}`,
  ];
}

export function exportSpecialtyReportExcel(params: {
  filters: SpecialtyReportFilters;
  kpis: SpecialtyReportKpis;
  months: SpecialtyReportMonthRow[];
  rows: SpecialtyReportGroupRow[];
  groupByLabel: string;
}) {
  const { filters, kpis, months, rows, groupByLabel } = params;
  const wb = XLSX.utils.book_new();

  const resumo: (string | number)[][] = [
    ["Pagamentos por especialidade / PJ"],
    [],
    ...filterLines(filters).map((l) => [l]),
    [],
    ["Indicador", "Valor"],
    ["Total bruto", kpis.bruto],
    ["Total líquido (PJ/lote)", kpis.liquido],
    ["Itens", kpis.items],
    ["PJs", kpis.companies],
    ["Médicos", kpis.doctors],
    ["Sem médico vinculado — bruto", kpis.semMedicoBruto],
    ["Sem médico vinculado — itens", kpis.semMedicoItems],
    [],
    ["Competência", "Bruto", "Itens"],
    ...months.map((m) => [m.month, m.bruto, m.items]),
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = [{ wch: 42 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const detalhe: (string | number)[][] = [
    [groupByLabel, "Referência", "Especialidades (cadastro)", "Itens", "Bruto"],
    ...rows.map((r) => [r.label, r.sublabel, r.specialties, r.items, r.bruto]),
  ];
  const wsDetalhe = XLSX.utils.aoa_to_sheet(detalhe);
  wsDetalhe["!cols"] = [{ wch: 44 }, { wch: 24 }, { wch: 40 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDetalhe, "Detalhado");

  XLSX.writeFile(wb, `pagamentos-por-especialidade-${Date.now()}.xlsx`);
}

export async function exportSpecialtyReportPdf(params: {
  filters: SpecialtyReportFilters;
  kpis: SpecialtyReportKpis;
  rows: SpecialtyReportGroupRow[];
  groupByLabel: string;
}) {
  const { filters, kpis, rows, groupByLabel } = params;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const marginX = 12;

  let y = await drawReportHeader(doc, {
    title: "Pagamentos por especialidade / PJ",
    subtitle: filterLines(filters).join("  ·  "),
    marginX,
    logoHeightMm: 12,
  });

  autoTable(doc, {
    startY: y + 2,
    head: [["Total bruto", "Total líquido (PJ/lote)", "Itens", "PJs", "Médicos", "Sem médico vinculado"]],
    body: [
      [
        money(kpis.bruto),
        money(kpis.liquido),
        String(kpis.items),
        String(kpis.companies),
        String(kpis.doctors),
        `${money(kpis.semMedicoBruto)} (${kpis.semMedicoItems} itens)`,
      ],
    ],
    theme: "grid",
    styles: { fontSize: 8 },
    headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255 },
    margin: { left: marginX, right: marginX },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  autoTable(doc, {
    startY: y,
    head: [[groupByLabel, "Referência", "Especialidades (cadastro)", "Itens", "Bruto"]],
    body: rows.map((r) => [
      r.label,
      r.sublabel,
      r.specialties,
      String(r.items),
      money(r.bruto),
    ]),
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: marginX, right: marginX },
  });

  doc.save(`pagamentos-por-especialidade-${Date.now()}.pdf`);
}
