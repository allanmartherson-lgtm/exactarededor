/**
 * Geração unificada do PDF do relatório de pagamento.
 *
 * MOTIVAÇÃO: o PDF do lote (PaymentDetail) e o PDF do relatório por empresa
 * (PaymentReportModal) precisam ser idênticos em estrutura, colunas e
 * lógica de "Validações Assistenciais" (raw findings + regras sintetizadas
 * com action=informar). Centralizamos aqui para evitar divergência.
 *
 * Quando chamado a partir do modal do relatório por empresa, basta passar
 * `items`/`groups` já filtrados — o layout é o mesmo do lote.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate } from "@/lib/status";
import type {
  PaymentRow,
  PaymentItemRow,
  GroupRow,
  ObservationRow,
  RuleLite,
} from "@/hooks/usePaymentDetailData";

export type GeneratePaymentPdfInput = {
  payment: PaymentRow;
  items: PaymentItemRow[];
  groups: GroupRow[];
  observations?: ObservationRow[];
  profiles?: Record<string, string>;
  rulesIndex?: Record<string, RuleLite>;
};

type DocWithLastTable = jsPDF & { lastAutoTable?: { finalY?: number } };

function formatFindingText(f: any): string {
  const name = f?.rule_name || f?.kind || "Validação";
  const ci = f?.conflicting_item;
  let conflictDetail = "";
  if (ci) {
    const parts: string[] = [];
    if (ci.doctor_name) parts.push(`Médico: ${ci.doctor_name}`);
    if (ci.company_name) parts.push(`Empresa: ${ci.company_name}`);
    if (ci.attendance_number) parts.push(`Atend: ${ci.attendance_number}`);
    if (parts.length > 0) conflictDetail = ` → conflita com [${parts.join(" · ")}]`;
  }
  const msg = f?.message || "";
  if (conflictDetail) return `${name}: ${msg}${conflictDetail}`;
  return msg ? `${name}: ${msg}` : name;
}

export function generatePaymentReportPdf(input: GeneratePaymentPdfInput): jsPDF {
  const { payment, items, groups, observations = [], profiles = {}, rulesIndex } = input;

  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Validação de Pagamento Médico", 14, 18);
  doc.setFontSize(10);
  doc.text(`Referência: ${payment.reference}`, 14, 28);
  doc.text(`Status: ${payment.status}`, 14, 34);
  // Total: usa a soma dos itens entregues — assim o relatório por empresa
  // mostra o total da empresa, e o relatório do lote mostra o total do lote.
  const totalItems = items.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0);
  doc.text(`Total: ${formatCurrency(totalItems)}`, 14, 40);

  // Aprovador / data: prioriza payment.approved_*; se ausente, deriva do
  // grupo aprovado mais recente (agregação por trigger).
  const approvedGroups = groups.filter((g) => g.approved_at && g.approved_by);
  const latestApprovedGroup = approvedGroups
    .slice()
    .sort((a, b) => (a.approved_at! < b.approved_at! ? 1 : -1))[0];
  const approverId = payment.approved_by ?? latestApprovedGroup?.approved_by ?? null;
  const approverAt = payment.approved_at ?? latestApprovedGroup?.approved_at ?? null;
  const aprovador = approverId ? (profiles[approverId] ?? "—") : "—";
  const aprovadoEm = approverAt ? formatDate(approverAt) : "—";
  doc.text(`Aprovado por: ${aprovador}  ·  em: ${aprovadoEm}`, 14, 46);

  // Totais por empresa
  let cursorYTop = 54;
  if (groups.length > 0) {
    doc.setFontSize(12);
    doc.text(`Totais por empresa (${groups.length})`, 14, cursorYTop);
    autoTable(doc, {
      startY: cursorYTop + 4,
      head: [["Empresa", "Itens", "Status", "Total"]],
      body: groups.map((g) => [
        g.company_name,
        String(g.items_count ?? 0),
        g.status,
        formatCurrency(g.total_amount ?? 0),
      ]),
      foot: [[
        "Total geral",
        String(groups.reduce((s, g) => s + (g.items_count ?? 0), 0)),
        "",
        formatCurrency(groups.reduce((s, g) => s + Number(g.total_amount ?? 0), 0)),
      ]],
      styles: { fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    });
    cursorYTop = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorYTop) + 8;
  }

  // Tabela de itens
  autoTable(doc, {
    startY: cursorYTop,
    head: [["Médico", "Doc", "Descrição", "Valor", "IA"]],
    body: items.map((i) => [
      i.doctor_name,
      i.doctor_document ?? "",
      i.description ?? "",
      formatCurrency(i.gross_amount),
      i.ai_status,
    ]),
    styles: { fontSize: 8 },
  });

  // Divergências
  let cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? 60) + 8;
  const divergencias = items.filter(
    (i) => i.ai_status === "alerta" || i.ai_status === "reprovado" || (i.ai_findings?.alerts?.length ?? 0) > 0,
  );
  if (divergencias.length > 0) {
    doc.setFontSize(12);
    doc.text(`Divergências (${divergencias.length})`, 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Item", "Status", "Motivos"]],
      body: divergencias.map((i) => [
        `${i.doctor_name}${i.attendance_number ? ` · #${i.attendance_number}` : ""}`,
        i.ai_status,
        ((i.ai_findings?.alerts ?? []) as string[]).join(" | ") || "—",
      ]),
      styles: { fontSize: 8, cellWidth: "wrap" },
      columnStyles: { 2: { cellWidth: 110 } },
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Validações assistenciais — replica popover "Validação (N)": findings
  // explícitos + entradas sintetizadas para regras disparadas sem conflito
  // (action=informar), usando rulesIndex. Mesma lógica do Excel.
  const validationRows: Array<[string, string]> = [];
  for (const it of items) {
    const raw = Array.isArray((it as any).validation_findings)
      ? ((it as any).validation_findings as any[])
      : [];
    const known = new Set(
      raw.map((f) => String(f?.rule_id ?? f?.rule_name ?? "").toLowerCase()),
    );
    const synth: any[] = [];
    const matched: string[] = ((it as any).ai_findings?.matched_rule_ids ?? []) as string[];
    matched.forEach((rid) => {
      const key = String(rid).toLowerCase();
      if (known.has(key)) return;
      const rule = rulesIndex?.[rid];
      if (!rule) return;
      known.add(key);
      synth.push({
        rule_name: rule.name,
        message: rule.description || "Regra disparada — sem conflito ou bloqueio.",
      });
    });
    const all = [...raw, ...synth];
    if (all.length === 0) continue;
    const text = all.map((f: any) => formatFindingText(f)).join(" | ");
    const label = `${(it as any).doctor_name ?? "—"}${(it as any).attendance_number ? ` · #${(it as any).attendance_number}` : ""}`;
    validationRows.push([label, text]);
  }
  if (validationRows.length > 0) {
    if (cursorY > 250) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(12);
    doc.text(`Validações assistenciais (${validationRows.length})`, 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Item", "Validações"]],
      body: validationRows,
      styles: { fontSize: 8, cellWidth: "wrap" },
      columnStyles: { 1: { cellWidth: 130 } },
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Histórico (observações)
  if (observations.length > 0) {
    if (cursorY > 250) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(12);
    doc.text(`Histórico de observações (${observations.length})`, 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Data/hora", "Autor", "Papel", "Mensagem"]],
      body: [...observations]
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .map((o) => [
          formatDate(o.created_at),
          (o.author_id && profiles[o.author_id]) || "—",
          o.author_type,
          o.message,
        ]),
      styles: { fontSize: 8 },
      columnStyles: { 3: { cellWidth: 95 } },
    });
  }

  return doc;
}
