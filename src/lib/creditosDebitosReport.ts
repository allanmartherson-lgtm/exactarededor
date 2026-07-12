/**
 * Créditos e Débitos — módulo de relatórios (PDF + Excel).
 *
 * Objetivo: um único ponto que consome o estado já carregado na tela
 * (glosa_debts + company_financial_adjustments + company_adjustment_applications)
 * e enriquece com `glosa_payment_applications` para gerar a visão completa
 * de "aplicado em qual lote, quando, por quem, status do lote".
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";

// ============ Tipos de entrada ============
export type ReportFiltersSummary = {
  periodLabel: string;
  pjLabel: string;
  ccLabel: string;
  trackLabel: string;
  tipoLabel: string;
  search: string;
  hospitalName?: string;
};

export type ReportGlosaDebt = {
  id: string;
  company_id: string;
  doctor_name: string;
  doctor_crm: string | null;
  total_debt: number;
  parcelas_default: number | null;
  confirmed_at: string | null;
  target_payment_id: string | null;
  origem_payment_id: string | null;
  _company_name?: string;
  _origem_cc?: string | null;
  _origem_track?: string | null;
};

export type ReportAdjustment = {
  id: string;
  company_id: string;
  tipo: string;
  descricao: string;
  valor_total: number;
  parcelas_total: number;
  parcelas_pagas: number;
  data_inicio: string;
  ativo: boolean;
  origem: string | null;
  recorrente: boolean;
  data_fim: string | null;
  _company_name?: string;
};

export type ReportAdjApplication = {
  id: string;
  adjustment_id: string;
  payment_id: string;
  parcela_numero: number | null;
  valor_aplicado: number;
  status: string;
  source: string | null;
  applied_at: string | null;
  confirmed_at: string | null;
  reverted_at: string | null;
  reverted_reason: string | null;
};

export type BuildReportInput = {
  filters: ReportFiltersSummary;
  pendentes: ReportGlosaDebt[];
  emAndamento: ReportGlosaDebt[];
  ajustes: ReportAdjustment[];
  appsByAdj: Record<string, ReportAdjApplication[]>;
  paymentLabels: Record<string, string>;
};

// ============ Tipos de saída ============
type LoteInfo = { reference: string | null; competence: string | null; status: string };

export type ReportData = {
  filters: ReportFiltersSummary;
  generatedAt: Date;
  kpis: {
    aConfirmarQtd: number;
    aConfirmarValor: number;
    emAndamentoQtd: number;
    emAndamentoValor: number;
    aplicadoPeriodoQtd: number;
    aplicadoPeriodoValor: number;
    semLoteAlvo: number;
  };
  pendentes: Array<{
    pj: string;
    medico: string;
    crm: string;
    valor: number;
    cc: string;
    trilha: string;
    origemLote: string;
    criadoEm: string;
  }>;
  emAndamento: Array<{
    pj: string;
    medico: string;
    crm: string;
    valor: number;
    parcelas: number;
    parcelaValor: number;
    loteAlvo: string;
    statusLote: string;
    confirmadoEm: string;
    confirmadoPor: string;
  }>;
  aplicadas: Array<{
    pj: string;
    medico: string;
    crm: string;
    valor: number;
    parcela: string;
    lote: string;
    statusLote: string;
    status: string;
    origem: string;
    aplicadoEm: string;
    confirmadoEm: string;
    aplicadoPor: string;
  }>;
  ajustesAplicados: Array<{
    pj: string;
    tipo: string;
    descricao: string;
    valor: number;
    parcela: string;
    lote: string;
    status: string;
    data: string;
  }>;
};

// ============ Helpers ============
const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const dt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};
const fmtCompetence = (s: string | null) => {
  if (!s) return "—";
  const [y, m] = s.split("-");
  return m && y ? `${m}/${y}` : s;
};

// ============ Builder ============
export async function buildReportData(input: BuildReportInput): Promise<ReportData> {
  const { filters, pendentes, emAndamento, ajustes, appsByAdj, paymentLabels } = input;

  // 1. Coleta ids de dívidas em andamento (para buscar aplicações reais)
  const debtIds = emAndamento.map((d) => d.id);
  const loteIds = new Set<string>();
  emAndamento.forEach((d) => { if (d.target_payment_id) loteIds.add(d.target_payment_id); });
  Object.values(appsByAdj).flat().forEach((ap) => { if (ap.payment_id) loteIds.add(ap.payment_id); });

  // 2. Busca glosa_payment_applications de todas as dívidas em andamento
  type RawGpa = {
    id: string;
    glosa_debt_id: string;
    payment_id: string;
    parcela_numero: number;
    valor_aplicado: number;
    status: string;
    source: string | null;
    applied_at: string;
    applied_by: string | null;
    confirmed_at: string | null;
    confirmed_by: string | null;
    reverted_at: string | null;
  };
  let gpaRows: RawGpa[] = [];
  if (debtIds.length) {
    const { data } = await (supabase as any)
      .from("glosa_payment_applications")
      .select("id, glosa_debt_id, payment_id, parcela_numero, valor_aplicado, status, source, applied_at, applied_by, confirmed_at, confirmed_by, reverted_at")
      .in("glosa_debt_id", debtIds);
    gpaRows = (data ?? []) as RawGpa[];
    gpaRows.forEach((r) => { if (r.payment_id) loteIds.add(r.payment_id); });
  }

  // 3. Busca metadados de lotes + perfis (author names)
  const loteInfoMap = new Map<string, LoteInfo>();
  if (loteIds.size) {
    const { data } = await supabase
      .from("payments")
      .select("id, reference, competence_month, status")
      .in("id", Array.from(loteIds));
    ((data as any[]) ?? []).forEach((p) => {
      loteInfoMap.set(p.id, { reference: p.reference ?? null, competence: p.competence_month ?? null, status: p.status });
    });
  }

  const authorIds = new Set<string>();
  emAndamento.forEach((d) => { /* confirmed_by not carried in ReportGlosaDebt to keep types slim */ });
  gpaRows.forEach((r) => {
    if (r.applied_by) authorIds.add(r.applied_by);
    if (r.confirmed_by) authorIds.add(r.confirmed_by);
  });
  const authorMap = new Map<string, string>();
  if (authorIds.size) {
    const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", Array.from(authorIds));
    ((data as any[]) ?? []).forEach((p) => {
      authorMap.set(p.user_id, p.full_name || p.email || p.user_id.slice(0, 8));
    });
  }

  const loteLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const info = loteInfoMap.get(id);
    if (!info) return paymentLabels[id] ?? id.slice(0, 8);
    return `${info.reference ?? id.slice(0, 8)} · ${fmtCompetence(info.competence)}`;
  };
  const loteStatus = (id: string | null | undefined) => {
    if (!id) return "—";
    return loteInfoMap.get(id)?.status ?? "—";
  };

  // 4. KPIs
  const now = new Date();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const aplicadoPeriodo = gpaRows.filter((r) => r.status !== "revertido" && r.status !== "postponed").reduce(
    (acc, r) => {
      const t = new Date(r.confirmed_at ?? r.applied_at).getTime();
      if (t >= m0) {
        acc.qtd += 1;
        acc.val += Number(r.valor_aplicado ?? 0);
      }
      return acc;
    },
    { qtd: 0, val: 0 },
  );
  // Soma também aplicações de ajustes manuais no período
  Object.values(appsByAdj).flat().forEach((ap) => {
    if (ap.status === "revertido") return;
    const t = new Date(ap.confirmed_at ?? ap.applied_at ?? 0).getTime();
    if (t >= m0) {
      aplicadoPeriodo.qtd += 1;
      aplicadoPeriodo.val += Number(ap.valor_aplicado ?? 0);
    }
  });

  const kpis = {
    aConfirmarQtd: pendentes.length,
    aConfirmarValor: pendentes.reduce((s, d) => s + Number(d.total_debt), 0),
    emAndamentoQtd: emAndamento.length,
    emAndamentoValor: emAndamento.reduce((s, d) => s + Number(d.total_debt), 0),
    aplicadoPeriodoQtd: aplicadoPeriodo.qtd,
    aplicadoPeriodoValor: aplicadoPeriodo.val,
    semLoteAlvo: emAndamento.filter((d) => !d.target_payment_id).length,
  };

  // 5. Seções
  const pendentesRows = pendentes.map((d) => ({
    pj: d._company_name ?? "—",
    medico: d.doctor_name,
    crm: d.doctor_crm ?? "—",
    valor: Number(d.total_debt),
    cc: d._origem_cc ?? "—",
    trilha: d._origem_track ?? "—",
    origemLote: loteLabel(d.origem_payment_id),
    criadoEm: "", // criado_at não vem carregado aqui; opcional
  }));

  const emAndamentoRows = emAndamento.map((d) => {
    const parc = d.parcelas_default ?? 1;
    return {
      pj: d._company_name ?? "—",
      medico: d.doctor_name,
      crm: d.doctor_crm ?? "—",
      valor: Number(d.total_debt),
      parcelas: parc,
      parcelaValor: Number(d.total_debt) / parc,
      loteAlvo: loteLabel(d.target_payment_id),
      statusLote: loteStatus(d.target_payment_id),
      confirmadoEm: dt(d.confirmed_at),
      confirmadoPor: "—", // não temos confirmed_by carregado em ReportGlosaDebt
    };
  });

  const aplicadasRows = gpaRows
    .sort((a, b) => new Date(b.confirmed_at ?? b.applied_at).getTime() - new Date(a.confirmed_at ?? a.applied_at).getTime())
    .map((r) => {
      const debt = emAndamento.find((d) => d.id === r.glosa_debt_id);
      const total = debt?.parcelas_default ?? 1;
      return {
        pj: debt?._company_name ?? "—",
        medico: debt?.doctor_name ?? "—",
        crm: debt?.doctor_crm ?? "—",
        valor: Number(r.valor_aplicado ?? 0),
        parcela: `${r.parcela_numero}/${total}`,
        lote: loteLabel(r.payment_id),
        statusLote: loteStatus(r.payment_id),
        status: r.status,
        origem: r.source ?? "glosa",
        aplicadoEm: dt(r.applied_at),
        confirmadoEm: dt(r.confirmed_at),
        aplicadoPor: r.confirmed_by ? authorMap.get(r.confirmed_by) ?? "—" : r.applied_by ? authorMap.get(r.applied_by) ?? "—" : "—",
      };
    });

  const ajustesAplicadosRows: ReportData["ajustesAplicados"] = [];
  ajustes.forEach((a) => {
    const apps = appsByAdj[a.id] ?? [];
    apps.forEach((ap) => {
      ajustesAplicadosRows.push({
        pj: a._company_name ?? "—",
        tipo: a.tipo,
        descricao: a.descricao,
        valor: Number(ap.valor_aplicado ?? 0),
        parcela: `${ap.parcela_numero ?? "—"}/${a.parcelas_total}`,
        lote: paymentLabels[ap.payment_id] ?? loteLabel(ap.payment_id),
        status: ap.status,
        data: dt(ap.confirmed_at ?? ap.applied_at),
      });
    });
  });

  return {
    filters,
    generatedAt: new Date(),
    kpis,
    pendentes: pendentesRows,
    emAndamento: emAndamentoRows,
    aplicadas: aplicadasRows,
    ajustesAplicados: ajustesAplicadosRows,
  };
}

// ============ EXCEL ============
function styleHeaderRow(ws: XLSX.WorkSheet, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "01498E" } },
      alignment: { horizontal: "left", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "BFBFBF" } },
        bottom: { style: "thin", color: { rgb: "BFBFBF" } },
      },
    };
  }
}

function applyCurrencyFormat(ws: XLSX.WorkSheet, colIndex: number, rowCount: number) {
  for (let r = 1; r <= rowCount; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: colIndex })];
    if (cell) cell.z = 'R$ #,##0.00;[Red](R$ #,##0.00)';
  }
}

function autoWidth(ws: XLSX.WorkSheet, aoa: any[][]) {
  const widths = (aoa[0] as any[]).map((_, c) => {
    let max = 8;
    aoa.forEach((row) => {
      const v = row?.[c];
      const s = v == null ? "" : String(v);
      if (s.length > max) max = Math.min(60, s.length + 2);
    });
    return { wch: max };
  });
  ws["!cols"] = widths;
}

export function generateCreditosDebitosXlsx(data: ReportData): Blob {
  const wb = XLSX.utils.book_new();

  // Resumo
  const resumoAoa = [
    ["Créditos e Débitos — Relatório"],
    ["Gerado em", data.generatedAt.toLocaleString("pt-BR")],
    ["Hospital", data.filters.hospitalName ?? "—"],
    [],
    ["Filtros aplicados"],
    ["Período", data.filters.periodLabel],
    ["PJ", data.filters.pjLabel],
    ["Centro de custo", data.filters.ccLabel],
    ["Trilha", data.filters.trackLabel],
    ["Tipo", data.filters.tipoLabel],
    ["Busca", data.filters.search || "—"],
    [],
    ["Indicadores"],
    ["A confirmar (qtd)", data.kpis.aConfirmarQtd],
    ["A confirmar (R$)", data.kpis.aConfirmarValor],
    ["Em andamento (qtd)", data.kpis.emAndamentoQtd],
    ["Em andamento (R$)", data.kpis.emAndamentoValor],
    ["Aplicado no mês (qtd)", data.kpis.aplicadoPeriodoQtd],
    ["Aplicado no mês (R$)", data.kpis.aplicadoPeriodoValor],
    ["Sem lote-alvo", data.kpis.semLoteAlvo],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoAoa);
  // Formatação de moeda nas linhas apropriadas
  ["B15", "B17", "B19"].forEach((addr) => { if (wsResumo[addr]) wsResumo[addr].z = 'R$ #,##0.00'; });
  wsResumo["A1"].s = { font: { name: "Arial", sz: 14, bold: true, color: { rgb: "01498E" } } };
  ["A5", "A13"].forEach((addr) => {
    if (wsResumo[addr]) wsResumo[addr].s = { font: { name: "Arial", sz: 11, bold: true, color: { rgb: "01498E" } } };
  });
  wsResumo["!cols"] = [{ wch: 26 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // Aplicadas
  if (data.aplicadas.length) {
    const headers = ["PJ", "Médico", "CRM", "Valor aplicado", "Parcela", "Lote", "Status lote", "Status aplicação", "Origem", "Aplicado em", "Confirmado em", "Aplicado por"];
    const rows = data.aplicadas.map((r) => [r.pj, r.medico, r.crm, r.valor, r.parcela, r.lote, r.statusLote, r.status, r.origem, r.aplicadoEm, r.confirmadoEm, r.aplicadoPor]);
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    applyCurrencyFormat(ws, 3, rows.length);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Glosas aplicadas");
  }

  // Em andamento
  if (data.emAndamento.length) {
    const headers = ["PJ", "Médico", "CRM", "Total débito", "Parcelas", "Valor por parcela", "Lote-alvo", "Status lote", "Confirmado em"];
    const rows = data.emAndamento.map((r) => [r.pj, r.medico, r.crm, r.valor, r.parcelas, r.parcelaValor, r.loteAlvo, r.statusLote, r.confirmadoEm]);
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    applyCurrencyFormat(ws, 3, rows.length);
    applyCurrencyFormat(ws, 5, rows.length);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Em andamento");
  }

  // A confirmar
  if (data.pendentes.length) {
    const headers = ["PJ", "Médico", "CRM", "Valor proposto", "Centro de custo", "Trilha", "Lote de origem"];
    const rows = data.pendentes.map((r) => [r.pj, r.medico, r.crm, r.valor, r.cc, r.trilha, r.origemLote]);
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    applyCurrencyFormat(ws, 3, rows.length);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, "A confirmar");
  }

  // Ajustes manuais aplicados
  if (data.ajustesAplicados.length) {
    const headers = ["PJ", "Tipo", "Descrição", "Valor", "Parcela", "Lote", "Status", "Data"];
    const rows = data.ajustesAplicados.map((r) => [r.pj, r.tipo, r.descricao, r.valor, r.parcela, r.lote, r.status, r.data]);
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    applyCurrencyFormat(ws, 3, rows.length);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Ajustes manuais");
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ============ PDF ============
export async function generateCreditosDebitosPdf(data: ReportData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const marginX = 10;
  const subtitleParts = [
    data.filters.hospitalName,
    `Período: ${data.filters.periodLabel}`,
    data.filters.pjLabel !== "Todas as PJs" ? `PJ: ${data.filters.pjLabel}` : null,
    data.filters.ccLabel !== "Todos CCs" ? `CC: ${data.filters.ccLabel}` : null,
    data.filters.trackLabel !== "Todas trilhas" ? `Trilha: ${data.filters.trackLabel}` : null,
    data.filters.tipoLabel !== "Todos os tipos" ? `Tipo: ${data.filters.tipoLabel}` : null,
    data.filters.search ? `Busca: "${data.filters.search}"` : null,
  ].filter(Boolean).join(" · ");

  let y = await drawReportHeader(doc, {
    title: "Créditos e Débitos",
    subtitle: subtitleParts,
    marginX,
    logoHeightMm: 12,
  });

  // KPIs em cards horizontais
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardsPerRow = 4;
  const gap = 3;
  const cardWidth = (pageWidth - marginX * 2 - gap * (cardsPerRow - 1)) / cardsPerRow;
  const cardHeight = 16;
  const kpiCards = [
    { label: "A CONFIRMAR", value: brl(data.kpis.aConfirmarValor), hint: `${data.kpis.aConfirmarQtd} glosa(s)`, color: [220, 38, 38] as [number, number, number] },
    { label: "EM ANDAMENTO", value: brl(data.kpis.emAndamentoValor), hint: `${data.kpis.emAndamentoQtd} débito(s)`, color: [217, 119, 6] as [number, number, number] },
    { label: "APLICADO NO MÊS", value: brl(data.kpis.aplicadoPeriodoValor), hint: `${data.kpis.aplicadoPeriodoQtd} aplicação(ões)`, color: [5, 150, 105] as [number, number, number] },
    { label: "SEM LOTE-ALVO", value: String(data.kpis.semLoteAlvo), hint: "risco de não aplicar", color: [217, 119, 6] as [number, number, number] },
  ];
  kpiCards.forEach((k, i) => {
    const x = marginX + i * (cardWidth + gap);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(k.label, x + 3, y + 4);
    doc.setFontSize(11);
    doc.setTextColor(...k.color);
    doc.text(k.value, x + 3, y + 9.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(k.hint, x + 3, y + 13.5);
  });
  y += cardHeight + 5;

  const drawSection = (title: string, headers: string[], rows: any[][]) => {
    if (rows.length === 0) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.text(title, marginX, y);
    y += 4;
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: y,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 7.5, cellPadding: 1.5, overflow: "linebreak" },
      headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB as any, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
      alternateRowStyles: { fillColor: [245, 247, 250] as any },
      theme: "grid",
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  };

  if (data.aplicadas.length) {
    drawSection(
      `Glosas aplicadas (${data.aplicadas.length})`,
      ["PJ", "Médico", "Valor", "Parcela", "Lote", "Status lote", "Origem", "Confirmado em", "Aplicado por"],
      data.aplicadas.map((r) => [r.pj, r.medico, brl(r.valor), r.parcela, r.lote, r.statusLote, r.origem, r.confirmadoEm, r.aplicadoPor]),
    );
  }
  if (data.emAndamento.length) {
    drawSection(
      `Em andamento — aguardando lote (${data.emAndamento.length})`,
      ["PJ", "Médico", "CRM", "Total", "Parc.", "Valor/parc.", "Lote-alvo", "Status lote", "Confirmado"],
      data.emAndamento.map((r) => [r.pj, r.medico, r.crm, brl(r.valor), String(r.parcelas), brl(r.parcelaValor), r.loteAlvo, r.statusLote, r.confirmadoEm]),
    );
  }
  if (data.pendentes.length) {
    drawSection(
      `A confirmar (${data.pendentes.length})`,
      ["PJ", "Médico", "CRM", "Valor proposto", "CC", "Trilha", "Origem"],
      data.pendentes.map((r) => [r.pj, r.medico, r.crm, brl(r.valor), r.cc, r.trilha, r.origemLote]),
    );
  }
  if (data.ajustesAplicados.length) {
    drawSection(
      `Ajustes manuais aplicados (${data.ajustesAplicados.length})`,
      ["PJ", "Tipo", "Descrição", "Valor", "Parcela", "Lote", "Status", "Data"],
      data.ajustesAplicados.map((r) => [r.pj, r.tipo, r.descricao, brl(r.valor), r.parcela, r.lote, r.status, r.data]),
    );
  }

  // Rodapé
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.text(
      `Gerado em ${data.generatedAt.toLocaleString("pt-BR")}`,
      marginX,
      pageHeight - 5,
    );
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - marginX,
      pageHeight - 5,
      { align: "right" },
    );
  }

  return doc;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
