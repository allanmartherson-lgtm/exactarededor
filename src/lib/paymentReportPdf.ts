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
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";
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
  /**
   * Inclui a seção "Histórico de observações" no PDF. Default: false.
   * Relatório executivo não traz histórico salvo se o analista pedir
   * explicitamente na hora da exportação.
   */
  includeHistory?: boolean;
};

type DocWithLastTable = jsPDF & { lastAutoTable?: { finalY?: number } };

function fmtDateISO(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return String(iso); }
}

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

export async function generatePaymentReportPdf(input: GeneratePaymentPdfInput): Promise<jsPDF> {
  // Itens cancelados ("não-devido") permanecem em payment_items para auditoria,
  // mas não devem aparecer em nenhuma vitrine do relatório — nem nas contagens,
  // somas, tabela de itens ou cobertura de regra.
  const activeInput: GeneratePaymentPdfInput = {
    ...input,
    items: input.items.filter((i) => !(i as any).is_cancelled),
  };
  const { payment } = activeInput;
  const isConfeccao = (payment as any)?.analysis_mode === "confeccao";

  if (isConfeccao) {
    return generateConfeccaoReportPdf(activeInput);
  }

  const { items, groups, observations = [], profiles = {}, rulesIndex, includeHistory = false } = activeInput;

  const doc = new jsPDF();
  const marginX = 14;

  // Cabeçalho institucional com a logo Rede D'Or (manual da marca 2025).
  const headerBottomY = await drawReportHeader(doc, {
    title: "Validação de Pagamento Médico",
    subtitle: `Referência ${payment.reference}  ·  Status: ${payment.status}`,
    marginX,
    logoHeightMm: 11,
  });

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  // Total: usa a soma dos itens entregues — assim o relatório por empresa
  // mostra o total da empresa, e o relatório do lote mostra o total do lote.
  // A tabela "Totais por empresa" soma o LÍQUIDO; para o header não divergir
  // dela, exibimos os dois valores rotulados quando há grupos.
  const totalItems = items.reduce((s, i) => s + Number(i.gross_amount ?? 0), 0);
  const totalLiquidoGrupos = groups.reduce(
    (s, g) => s + Number(g.liquido_total ?? g.total_amount ?? 0),
    0,
  );
  let metaY = headerBottomY;
  doc.text(
    groups.length > 0
      ? `Bruto (itens): ${formatCurrency(totalItems)}  ·  Líquido (empresas): ${formatCurrency(totalLiquidoGrupos)}`
      : `Total: ${formatCurrency(totalItems)}`,
    marginX,
    metaY,
  );
  metaY += 6;

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
  doc.text(`Aprovado por: ${aprovador}  ·  em: ${aprovadoEm}`, marginX, metaY);
  metaY += 6;

  // Totais por empresa
  let cursorYTop = metaY + 2;
  if (groups.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.text(`Totais por empresa (${groups.length})`, marginX, cursorYTop);
    doc.setTextColor(17, 24, 39);
    autoTable(doc, {
      startY: cursorYTop + 4,
      head: [["Empresa", "Itens", "Status", "Líquido"]],
      body: groups.map((g) => [
        g.company_name,
        String(g.items_count ?? 0),
        g.status,
        formatCurrency(g.liquido_total ?? g.total_amount ?? 0),
      ]),
      foot: [[
        "Total geral",
        String(groups.reduce((s, g) => s + (g.items_count ?? 0), 0)),
        "",
        formatCurrency(groups.reduce((s, g) => s + Number(g.liquido_total ?? g.total_amount ?? 0), 0)),
      ]],
      styles: { fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    });
    cursorYTop = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorYTop) + 8;
  }

  // Tabela de itens — quebras suaves para não cortar texto longo
  autoTable(doc, {
    startY: cursorYTop,
    head: [["Médico", "Doc", "Convênio", "Descrição", "Qtd", "Valor", "IA"]],
    body: items.map((i) => [
      i.doctor_name,
      i.doctor_document ?? "",
      (i as any).agreement_text ?? (i as any).convenio_slug ?? "",
      i.description ?? "",
      String((i as any).quantity ?? 1),
      formatCurrency(i.gross_amount),
      i.ai_status,
    ]),
    styles: { fontSize: 8, overflow: "linebreak", cellPadding: 1.6 },
    headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255 },
    margin: { left: marginX, right: marginX, bottom: 14 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
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

  // Memória de cálculo — mostra a fórmula/explicação gerada pelo motor para
  // cada item que tem `calculation_explanation`. Peça-chave para conferência
  // do que a regra fez (base × multiplicador × via × qtd = valor).
  const memoriaItems = items.filter((i) => {
    const exp = (i.ai_findings as any)?.calculation_explanation;
    return typeof exp === "string" && exp.trim().length > 0;
  });
  if (memoriaItems.length > 0) {
    if (cursorY > 220) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(12);
    doc.setTextColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.text(`Memória de cálculo (${memoriaItems.length})`, marginX, cursorY);
    doc.setTextColor(17, 24, 39);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Médico · Atend.", "Código", "Cálculo"]],
      body: memoriaItems.map((i) => [
        `${i.doctor_name ?? "—"}${(i as any).attendance_number ? ` · #${(i as any).attendance_number}` : ""}`,
        (i as any).procedure_code ?? "—",
        String((i.ai_findings as any)?.calculation_explanation ?? ""),
      ]),
      styles: { fontSize: 7, overflow: "linebreak", cellPadding: 1.6, valign: "top" },
      headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255, fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 22 },
        2: { cellWidth: 105 },
      },
      margin: { left: marginX, right: marginX, bottom: 14 },
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Alertas assistenciais — tabela comparativa lado a lado
  const alertItemsForPdf = items.filter((it) => {
    const vf = Array.isArray((it as any).validation_findings)
      ? ((it as any).validation_findings as any[])
      : [];
    return vf.length > 0;
  });

  if (alertItemsForPdf.length > 0) {
    if (cursorY > 220) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(12);
    doc.text(`Alertas Assistenciais`, 14, cursorY);

    const alertTableRows: string[][] = [];
    for (const it of alertItemsForPdf) {
      const findings = (it as any).validation_findings as any[];
      for (const f of findings) {
        const ci = f?.conflicting_item;
        const kindLabel = f?.rule_name || f?.kind || "Validação";

        const original = [
          (it as any).doctor_name ?? "—",
          (it as any).company_name ?? "—",
          (it as any).attendance_number ? `#${(it as any).attendance_number}` : "—",
          (it as any).specialty ?? "—",
          (it as any).patient_name ?? "—",
          (it as any).procedure_date ? formatDate((it as any).procedure_date) : "—",
          formatCurrency(Number((it as any).gross_amount ?? 0)),
        ].join("\n");

        const conflitante = ci ? [
          ci.doctor_name ?? "—",
          ci.company_name ?? "—",
          ci.attendance_number ? `#${ci.attendance_number}` : "—",
          ci.specialty ?? "—",
          ci.patient_name ?? "—",
          fmtDateISO(ci.procedure_date),

          ci.gross_amount != null ? formatCurrency(Number(ci.gross_amount)) : "—",
        ].join("\n") : (f?.message ?? "Sem item conflitante");

        alertTableRows.push([kindLabel, original, conflitante]);
      }
    }

    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Tipo de Alerta", "Item Original", "↔ Item Conflitante"]],
      body: alertTableRows,
      styles: { fontSize: 7, cellWidth: "wrap", valign: "top" },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 36 },
        1: { cellWidth: 75 },
        2: { cellWidth: 75, fillColor: [255, 247, 237] },
      },
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }


  // Histórico (observações) — só quando o analista pede explicitamente.
  if (includeHistory && observations.length > 0) {
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

/**
 * Relatório de Confecção — gerado quando o lote ainda está no modo de criação
 * de repasse. NÃO traz colunas/sections de IA (aprovado/alerta/reprovado),
 * divergências ou alertas assistenciais (esses só existem após a análise).
 * Foco: valor convênio (procedure_amount), repasse calculado pela regra
 * (expected_amount), cobertura de regra (com / sem regra) e itens descobertos.
 */
async function generateConfeccaoReportPdf(input: GeneratePaymentPdfInput): Promise<jsPDF> {
  const { payment, items, groups, observations = [], profiles = {}, rulesIndex } = input;

  const doc = new jsPDF();
  const marginX = 14;

  const headerBottomY = await drawReportHeader(doc, {
    title: "Relatório de Confecção de Repasse",
    subtitle: `Referência ${payment.reference}  ·  Modo: Confecção (cálculo de repasse)`,
    marginX,
    logoHeightMm: 11,
  });

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  const somaBruto = items.reduce((s, i) => s + Number((i as any).procedure_amount ?? 0), 0);
  const somaRepasse = items.reduce((s, i) => s + Number(i.expected_amount ?? 0), 0);
  let metaY = headerBottomY;
  doc.text(`Valor convênio (base): ${formatCurrency(somaBruto)}`, marginX, metaY);
  metaY += 6;
  doc.text(`Repasse calculado: ${formatCurrency(somaRepasse)}`, marginX, metaY);
  metaY += 6;
  doc.text(`Itens: ${items.length}  ·  Empresas: ${groups.length}`, marginX, metaY);
  metaY += 6;

  // Cobertura de regra
  let semRegra = 0;
  let comRegra = 0;
  for (const i of items) {
    const ruleId = (i as any).applied_rule_id ?? i.ai_findings?.matched_rule_ids?.[0] ?? null;
    const method = (i.applied_calc_method ?? "") as string;
    if (!ruleId && (!method || method === "sem_regra")) semRegra++;
    else comRegra++;
  }
  doc.text(`Cobertura: ${comRegra} com regra  ·  ${semRegra} sem regra`, marginX, metaY);
  metaY += 6;

  let cursorY = metaY + 2;

  // Totais por empresa (sem coluna de status — confecção não tem ai_status final)
  if (groups.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.text(`Totais por empresa (${groups.length})`, marginX, cursorY);
    doc.setTextColor(17, 24, 39);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Empresa", "Itens", "Valor convênio", "Repasse calculado"]],
      body: groups.map((g) => {
        const gItems = items.filter((i) => i.company_name === g.company_name);
        const bruto = gItems.reduce((s, i) => s + Number((i as any).procedure_amount ?? 0), 0);
        const rep = gItems.reduce((s, i) => s + Number(i.expected_amount ?? 0), 0);
        return [
          g.company_name,
          String(gItems.length),
          formatCurrency(bruto),
          formatCurrency(rep),
        ];
      }),
      foot: [[
        "Total geral",
        String(items.length),
        formatCurrency(somaBruto),
        formatCurrency(somaRepasse),
      ]],
      styles: { fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Itens
  autoTable(doc, {
    startY: cursorY,
    head: [["Médico", "Doc", "Convênio", "Descrição", "Qtd", "Valor convênio", "Repasse", "Piso", "Regra"]],
    body: items.map((i) => {
      const ruleId = (i as any).applied_rule_id ?? i.ai_findings?.matched_rule_ids?.[0] ?? null;
      const rule = ruleId ? rulesIndex?.[ruleId] : null;
      const method = (i.applied_calc_method ?? "") as string;
      const ruleCell = rule?.name
        ? `${rule.name}${method ? `\n(${method})` : ""}`
        : (!ruleId && (!method || method === "sem_regra")) ? "— sem regra —" : (method || "—");
      const pisoVal = (i as any).piso_aplicado_valor;
      const pisoMet = (i as any).piso_metodo_vencedor;
      const pisoCell = pisoVal != null
        ? `${formatCurrency(Number(pisoVal))}${pisoMet === "piso" ? "\n(piso aplicado)" : pisoMet === "convenio" ? "\n(convênio prevaleceu)" : ""}`
        : "—";
      return [
        i.doctor_name,
        i.doctor_document ?? "",
        (i as any).agreement_text ?? (i as any).convenio_slug ?? "",
        i.description ?? "",
        String((i as any).quantity ?? 1),
        formatCurrency(Number((i as any).procedure_amount ?? 0)),
        formatCurrency(Number(i.expected_amount ?? 0)),
        pisoCell,
        ruleCell,
      ];
    }),
    styles: { fontSize: 8, overflow: "linebreak", cellPadding: 1.6 },
    headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255 },
    margin: { left: marginX, right: marginX, bottom: 14 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;

  // Itens sem regra (destaque para o analista corrigir antes de fechar)
  const semRegraItems = items.filter((i) => {
    const ruleId = (i as any).applied_rule_id ?? i.ai_findings?.matched_rule_ids?.[0] ?? null;
    const method = (i.applied_calc_method ?? "") as string;
    return !ruleId && (!method || method === "sem_regra");
  });
  if (semRegraItems.length > 0) {
    if (cursorY > 230) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(12);
    doc.setTextColor(180, 83, 9);
    doc.text(`Itens sem regra (${semRegraItems.length}) — necessário cadastrar regra`, marginX, cursorY);
    doc.setTextColor(17, 24, 39);
    autoTable(doc, {
      startY: cursorY + 4,
      head: [["Médico", "Empresa", "Convênio", "TUSS", "Descrição", "Valor convênio"]],
      body: semRegraItems.map((i) => [
        i.doctor_name ?? "—",
        i.company_name ?? "—",
        (i as any).agreement_text ?? (i as any).convenio_slug ?? "—",
        i.procedure_code ?? "—",
        i.description ?? "—",
        formatCurrency(Number((i as any).procedure_amount ?? 0)),
      ]),
      styles: { fontSize: 8, overflow: "linebreak", cellPadding: 1.6 },
      headStyles: { fillColor: [217, 119, 6], textColor: 255 },
      margin: { left: marginX, right: marginX, bottom: 14 },
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Histórico de observações: relatório de Confecção é peça executiva, não
  // auditoria. Mostrar apenas contagem — quem precisa do detalhe abre na tela.
  if (observations.length > 0) {
    if (cursorY > 270) { doc.addPage(); cursorY = 20; }
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(
      `Observações registradas: ${observations.length}. Consulte a tela do lote para o detalhe.`,
      marginX,
      cursorY,
    );
    doc.setTextColor(17, 24, 39);
  }

  return doc;
}

