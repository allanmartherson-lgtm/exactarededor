// PDF do Simulador de Cenário — layout retrato A4, padrão Exacta / Rede D'Or.
// Reproduz o mesmo resumo visual da tela (config, DRE comparativa Aurum × Exacta Real × Simulado
// e cards HM). Não inclui detalhamento item a item — isso continua no Excel.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Cores institucionais Exacta / Rede D'Or.
const BRAND_PRIMARY: [number, number, number] = [0, 61, 165];   // #003DA5
const BRAND_BRONZE:  [number, number, number] = [198, 162, 124]; // #C6A27C
const NAVY_DARK:     [number, number, number] = [0, 40, 85];    // #002855
const TEXT_MUTED:    [number, number, number] = [110, 116, 128];
const ROW_HIGHLIGHT: [number, number, number] = [255, 249, 235]; // amber-50
const ROW_MARGIN:    [number, number, number] = [236, 253, 245]; // emerald-50
const BORDER_SOFT:   [number, number, number] = [220, 224, 232];

const fmtBRL = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtPCT = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v) < 1 ? v * 100 : v;
  return `${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};

export interface SimuladorPdfInput {
  modo: "medico" | "procedimento";
  nome: string;
  ano: number;
  carater: string;                 // "todos" | "Eletiva" | ...
  apenasInternados: boolean;
  conveniosExcluidos: string[];    // labels legíveis
  parametros: {
    modelo: string;                // "percentual" | "tabela_diferenciada"
    pct?: number | null;
    reference_table_label?: string | null;
    multiplicador?: number | null;
    deflator?: number | null;
    acrescimo?: number | null;
  };
  aurum: {
    qtd_cirurgias: number;
    receita: number;
    impostos: number;
    glosa_externa: number;
    receita_liquida: number;
    custo_opme: number;
    custo_mat_med: number;
    custo_hm: number;
    custo_exames_img: number;
    custo_laboratorio: number;
    outros_custos: number;
    margem: number;
    pct_margem: number;
  };
  exacta: {
    gross: number;
    itens: number;
    atendimentos: number;
  } | null;
  simulado: {
    novo_hm: number;
    nova_margem: number;
    nova_pct_margem: number;
  };
  semMatch: { count: number; valor: number };
  cobertura?: {
    calculados: number;
    total: number;
    pct: number;         // 0-1
    semMatch: number;
  } | null;
  dreView: "media" | "soma";
}

export function exportSimuladorCenarioPdf(input: SimuladorPdfInput) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentW = pageW - marginX * 2;

  // ============================ HEADER ============================
  doc.setFillColor(...NAVY_DARK);
  doc.rect(0, 0, pageW, 22, "F");
  // Ícone circular com check bronze (versão simplificada do ExactaIcon).
  doc.setFillColor(...BRAND_PRIMARY);
  doc.circle(marginX + 6, 11, 5, "F");
  doc.setDrawColor(...BRAND_BRONZE);
  doc.setLineWidth(0.9);
  doc.line(marginX + 3.6, 11.2, marginX + 5.4, 13);
  doc.line(marginX + 5.4, 13, marginX + 8.6, 9.2);
  doc.setLineWidth(0.2);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Exacta", marginX + 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(198, 162, 124);
  doc.text("PAGAMENTO MÉDICO · REDE D'OR", marginX + 14, 16.5);

  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  const emissao = new Date().toLocaleString("pt-BR");
  doc.text(`Emitido em ${emissao}`, pageW - marginX, 12, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(198, 162, 124);
  doc.text("Simulador de Cenário", pageW - marginX, 17, { align: "right" });

  // ============================ TÍTULO ============================
  let y = 30;
  doc.setTextColor(...NAVY_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const tipoLabel = input.modo === "medico" ? "Por Médico" : "Por Procedimento";
  doc.text(`Simulador de Cenário — ${tipoLabel}`, marginX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(`${input.nome} · ${input.ano}`, marginX, y);
  y += 6;

  // ============================ CONFIGURAÇÃO ============================
  const modeloBonito =
    input.parametros.modelo === "percentual" ? "% convênio" : "Tabela diferenciada";
  const configRows: [string, string][] = [
    ["Tipo", tipoLabel],
    [input.modo === "medico" ? "Médico" : "Procedimento", input.nome],
    ["Ano", String(input.ano)],
    ["Caráter", input.carater === "todos" ? "Todos" : input.carater],
    ["Apenas internados cirúrgicos", input.apenasInternados ? "Sim" : "Não"],
    [
      "Convênios excluídos",
      input.conveniosExcluidos.length > 0 ? input.conveniosExcluidos.join(", ") : "—",
    ],
    ["Modelo de simulação", modeloBonito],
  ];
  if (input.parametros.modelo === "percentual") {
    configRows.push(["% convênio", fmtPCT(input.parametros.pct ?? null)]);
  } else {
    configRows.push(["Tabela de referência", input.parametros.reference_table_label ?? "—"]);
    configRows.push(["Multiplicador (x)", String(input.parametros.multiplicador ?? "—")]);
    configRows.push(["Deflator (%)", String(input.parametros.deflator ?? "—")]);
    configRows.push(["Acréscimo (%)", String(input.parametros.acrescimo ?? "—")]);
  }

  autoTable(doc, {
    startY: y,
    head: [["Parâmetro", "Valor"]],
    body: configRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [0, 0, 0] },
    headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 55, textColor: TEXT_MUTED, fontStyle: "bold" },
      1: { cellWidth: contentW - 55 },
    },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ============================ DRE COMPARATIVA ============================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...NAVY_DARK);
  doc.text("DRE comparativa", marginX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const escala = input.dreView === "media" ? "por cirurgia (média)" : "acumulado (soma)";
  const infoLine =
    `Aurum: ${input.aurum.qtd_cirurgias.toLocaleString("pt-BR")} cirurgia(s)` +
    (input.exacta
      ? ` | Exacta: ${input.exacta.itens.toLocaleString("pt-BR")} item(ns) em ${input.exacta.atendimentos.toLocaleString("pt-BR")} atendimento(s)`
      : " | Exacta: sem match") +
    ` | Filtro: ${input.carater === "todos" ? "Todos" : input.carater}` +
    ` | Escala: ${escala}`;
  doc.text(infoLine, marginX, y + 4.5);
  y += 8;

  // Projeção do HM Exacta/Simulado à escala do Aurum (mesma lógica da tela).
  const A = input.aurum;
  const qc = A.qtd_cirurgias;
  const atd = input.exacta?.atendimentos ?? 0;
  const exGross = input.exacta?.gross ?? null;
  const exGrossProj =
    exGross != null && atd > 0 && qc > 0 ? (exGross / atd) * qc : exGross;
  const novoHmProj =
    atd > 0 && qc > 0 ? (input.simulado.novo_hm / atd) * qc : input.simulado.novo_hm;
  const novaMargemProj =
    atd > 0 && qc > 0 ? A.receita_liquida + A.outros_custos - novoHmProj : input.simulado.nova_margem;
  const margemExactaProj =
    exGrossProj != null ? A.receita_liquida + A.outros_custos - exGrossProj : null;
  const pctExactaProj =
    margemExactaProj != null && A.receita_liquida > 0
      ? margemExactaProj / A.receita_liquida
      : null;
  const rl = A.receita_liquida;
  const pctHmAurum = rl > 0 ? A.custo_hm / rl : null;
  const pctHmExacta = rl > 0 && exGrossProj != null ? exGrossProj / rl : null;
  const pctHmSim = rl > 0 ? novoHmProj / rl : null;
  const pctMargemSimProj = rl > 0 ? novaMargemProj / rl : null;

  const useMedia = input.dreView === "media";
  const suf = useMedia ? "/cir" : "";
  const scale = (v: number | null | undefined) =>
    v == null ? null : useMedia && qc > 0 ? v / qc : v;
  const pctBase = A.receita;
  const pctOf = (v: number | null | undefined) =>
    v != null && pctBase > 0 ? v / pctBase : null;

  interface Row {
    op: string;
    label: string;
    aurum: number | null;
    exacta: number | null;
    simulado: number | null;
    bold?: boolean;
    highlight?: "amber" | "emerald";
    indent?: boolean;
  }
  const rows: Row[] = [
    { op: "(+)", label: "Receita Bruta", aurum: A.receita, exacta: A.receita, simulado: A.receita, bold: true },
    { op: "(−)", label: "Impostos", aurum: -A.impostos, exacta: -A.impostos, simulado: -A.impostos, indent: true },
    { op: "(−)", label: "Glosas", aurum: -A.glosa_externa, exacta: -A.glosa_externa, simulado: -A.glosa_externa, indent: true },
    { op: "(=)", label: "Receita Líquida", aurum: A.receita_liquida, exacta: A.receita_liquida, simulado: A.receita_liquida, bold: true },
    { op: "(−)", label: "OPME", aurum: -A.custo_opme, exacta: -A.custo_opme, simulado: -A.custo_opme, indent: true },
    { op: "(−)", label: "Mat/Med", aurum: -A.custo_mat_med, exacta: -A.custo_mat_med, simulado: -A.custo_mat_med, indent: true },
    {
      op: "(−)", label: "Honorários Médicos",
      aurum: -A.custo_hm,
      exacta: exGrossProj != null ? -exGrossProj : null,
      simulado: -novoHmProj,
      indent: true,
      highlight: "amber",
      bold: true,
    },
    { op: "(−)", label: "Exames Imagem", aurum: -A.custo_exames_img, exacta: -A.custo_exames_img, simulado: -A.custo_exames_img, indent: true },
    { op: "(−)", label: "Laboratório", aurum: -A.custo_laboratorio, exacta: -A.custo_laboratorio, simulado: -A.custo_laboratorio, indent: true },
    {
      op: "(=)", label: "Margem de Contribuição",
      aurum: A.margem,
      exacta: margemExactaProj,
      simulado: novaMargemProj,
      bold: true,
      highlight: "emerald",
    },
  ];

  const body = rows.map((r) => {
    const showA = scale(r.aurum);
    const showE = scale(r.exacta);
    const showS = scale(r.simulado);
    const cellA = r.aurum == null ? "—" : `${fmtBRL(showA)}${r.aurum !== 0 && useMedia ? suf : ""}`;
    const cellE = r.exacta == null ? "—" : `${fmtBRL(showE)}${r.exacta !== 0 && useMedia ? suf : ""}`;
    const cellS = r.simulado == null ? "—" : `${fmtBRL(showS)}${r.simulado !== 0 && useMedia ? suf : ""}`;
    const pctA = pctOf(r.aurum);
    const pctE = pctOf(r.exacta);
    const pctS = pctOf(r.simulado);
    // Suffix de % logo abaixo do valor na mesma célula, como na tela.
    const withPct = (main: string, p: number | null) =>
      `${main}\n(${fmtPCT(p)})`;
    return [
      r.op,
      `${r.indent ? "   " : ""}${r.label}`,
      { content: withPct(cellA, pctA), styles: { halign: "right" as const } },
      { content: withPct(cellE, pctE), styles: { halign: "right" as const } },
      { content: withPct(cellS, pctS), styles: { halign: "right" as const, fontStyle: "bold" as const } },
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [[
      "",
      "",
      { content: "Aurum", styles: { halign: "right", fontStyle: "bold" } },
      { content: "Exacta Real", styles: { halign: "right", fontStyle: "bold" } },
      { content: "Simulado", styles: { halign: "right", fontStyle: "bold" } },
    ]],
    body,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 2, textColor: [0, 0, 0], lineColor: BORDER_SOFT },
    headStyles: { fillColor: BRAND_PRIMARY, textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center", textColor: TEXT_MUTED },
      1: { cellWidth: contentW - 10 - 32 * 3 },
      2: { cellWidth: 32 },
      3: { cellWidth: 32 },
      4: { cellWidth: 32, fillColor: [246, 249, 255] },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = rows[data.row.index];
      if (!row) return;
      if (row.highlight === "amber") data.cell.styles.fillColor = ROW_HIGHLIGHT;
      if (row.highlight === "emerald") data.cell.styles.fillColor = ROW_MARGIN;
      if (row.bold) data.cell.styles.fontStyle = "bold";
    },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;

  // Sub-linha: % HM sobre Receita Líquida (referência clássica).
  autoTable(doc, {
    startY: y,
    body: [[
      "",
      { content: "% HM sobre Receita Líquida", styles: { fontStyle: "italic", textColor: TEXT_MUTED } },
      { content: fmtPCT(pctHmAurum), styles: { halign: "right", textColor: TEXT_MUTED } },
      { content: fmtPCT(pctHmExacta), styles: { halign: "right", textColor: TEXT_MUTED } },
      { content: fmtPCT(pctHmSim), styles: { halign: "right", textColor: TEXT_MUTED, fontStyle: "bold" } },
    ], [
      "",
      { content: "% Margem", styles: { fontStyle: "italic", textColor: TEXT_MUTED } },
      { content: fmtPCT(A.pct_margem), styles: { halign: "right", textColor: TEXT_MUTED } },
      { content: fmtPCT(pctExactaProj), styles: { halign: "right", textColor: TEXT_MUTED } },
      { content: fmtPCT(pctMargemSimProj), styles: { halign: "right", textColor: NAVY_DARK, fontStyle: "bold" } },
    ]],
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 1.2 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: contentW - 10 - 32 * 3 },
      2: { cellWidth: 32 },
      3: { cellWidth: 32 },
      4: { cellWidth: 32 },
    },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ============================ CARDS HM ============================
  if (y > pageH - 55) {
    doc.addPage();
    y = 20;
  }
  const cardW = (contentW - 6) / 3;
  const cardH = 26;
  const cards: Array<{ title: string; valor: number | null; sub: string; highlight?: boolean; tone?: "positive" | "negative" | "neutral" }> = [
    {
      title: "HM AURUM (CONTÁBIL)",
      valor: -Math.abs(A.custo_hm),
      sub: rl > 0 ? `${fmtPCT(-A.custo_hm / rl)} da receita líquida` : "—",
    },
    {
      title: "HM EXACTA (REAL PAGO)",
      valor: input.exacta?.gross ?? null,
      sub: input.exacta
        ? `${fmtPCT(rl > 0 ? input.exacta.gross / rl : null)} da receita líquida · ${input.exacta.itens} item(s) · ${input.exacta.atendimentos} atend.`
        : "sem match",
    },
    {
      title: "HM SIMULADO (CENÁRIO)",
      valor: input.simulado.novo_hm,
      sub: input.exacta
        ? `${fmtPCT(rl > 0 ? input.simulado.novo_hm / rl : null)} da receita líquida · Δ vs Exacta: ${fmtBRL(input.simulado.novo_hm - input.exacta.gross)}`
        : `${fmtPCT(pctHmSim)} da receita líquida`,
      highlight: true,
      tone: input.exacta == null
        ? "neutral"
        : input.simulado.novo_hm > input.exacta.gross ? "negative" : "positive",
    },
  ];
  cards.forEach((c, i) => {
    const x = marginX + i * (cardW + 3);
    doc.setDrawColor(...(c.highlight ? BRAND_PRIMARY : BORDER_SOFT));
    doc.setLineWidth(c.highlight ? 0.6 : 0.2);
    if (c.highlight) {
      doc.setFillColor(246, 249, 255);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");
    } else {
      doc.roundedRect(x, y, cardW, cardH, 2, 2, "S");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...(c.highlight ? BRAND_PRIMARY : TEXT_MUTED));
    doc.text(c.title, x + 3, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    const valorColor: [number, number, number] =
      c.highlight ? BRAND_PRIMARY :
      c.tone === "negative" ? [185, 28, 28] :
      c.tone === "positive" ? [4, 120, 87] :
      [0, 0, 0];
    doc.setTextColor(...valorColor);
    doc.text(fmtBRL(c.valor), x + 3, y + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    // Quebra manual para caber na largura do card.
    const subLines = doc.splitTextToSize(c.sub, cardW - 6);
    doc.text(subLines, x + 3, y + 18);
  });
  y += cardH + 6;
  doc.setLineWidth(0.2);

  // ============================ AVISOS ============================
  const avisos: string[] = [];
  if (input.cobertura && input.cobertura.total > 0) {
    avisos.push(
      `Cobertura do motor: ${input.cobertura.calculados}/${input.cobertura.total} itens calculados ` +
      `(${(input.cobertura.pct * 100).toFixed(0)}%) — ${input.cobertura.semMatch} sem match.`,
    );
  }
  if (input.semMatch.count > 0) {
    avisos.push(
      `${input.semMatch.count} item(ns) sem match (pacote, sem acordo, TUSS fora da tabela…) — ` +
      `${fmtBRL(input.semMatch.valor)} mantidos ao valor pago à época para não distorcer o Simulado.`,
    );
  }
  if (avisos.length > 0) {
    if (y > pageH - 25) {
      doc.addPage();
      y = 20;
    }
    doc.setFillColor(255, 249, 235);
    doc.setDrawColor(234, 179, 8);
    doc.setLineWidth(0.2);
    const boxH = 6 + avisos.length * 5;
    doc.roundedRect(marginX, y, contentW, boxH, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text("Avisos", marginX + 3, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 53, 15);
    avisos.forEach((a, i) => {
      const lines = doc.splitTextToSize(`• ${a}`, contentW - 6);
      doc.text(lines, marginX + 3, y + 10 + i * 5);
    });
  }

  // ============================ FOOTER ============================
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER_SOFT);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageH - 12, pageW - marginX, pageH - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text("Exacta · Pagamento Médico · Rede D'Or", marginX, pageH - 7);
    doc.text(`Página ${p} de ${total}`, pageW - marginX, pageH - 7, { align: "right" });
  }

  const safe = input.nome.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  doc.save(`simulador_${safe}_${input.ano}.pdf`);
}
