import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { type TvrResult } from "@/lib/tvr";
import { EXPORT_COLS, buildExportRows } from "./exportCols";
import { format } from "date-fns";

export type TvrExportContext = {
  /** Universo completo da apuração (null antes de processar). */
  results: TvrResult[] | null;
  /** Lista já filtrada pela sub-aba corrente — usada no escopo "visible". */
  visible: TvrResult[];
  /** Reaplica busca/status/PJ/médico; `ignoreAnalysisTab` ignora a sub-aba. */
  applyVisibleFilters: (rows: TvrResult[], opts?: { ignoreAnalysisTab?: boolean }) => TvrResult[];
};

export async function exportTvrData(
  fmt: "xlsx" | "csv" | "json",
  scope: "all" | "visible" | "split" | "valor" | "presenca",
  ctx: TvrExportContext,
): Promise<void> {
  const { results, visible, applyVisibleFilters } = ctx;
  if (!results) return;
  // valor/presenca: aplicam todos os filtros (busca, status, PJ, médico,
  // apenas com pagamento) IGNORANDO a sub-aba atual, e restringem por
  // tipo_analise. Permite exportar só uma categoria sem trocar de aba.
  const list =
    scope === "visible"
      ? visible
      : scope === "split"
      ? applyVisibleFilters(results, { ignoreAnalysisTab: true })
      : scope === "valor"
      ? applyVisibleFilters(results, { ignoreAnalysisTab: true }).filter(
          (r) => r.tipo_analise === "valor",
        )
      : scope === "presenca"
      ? applyVisibleFilters(results, { ignoreAnalysisTab: true }).filter(
          (r) => r.tipo_analise === "quantidade",
        )
      : results;
  if (list.length === 0) {
    toast({ title: "Nada para exportar neste filtro", variant: "destructive" });
    return;
  }
  const stamp = format(new Date(), "yyyyMMdd_HHmm");
  const suffix =
    scope === "visible"
      ? "filtrado_"
      : scope === "split"
      ? "abas_"
      : scope === "valor"
      ? "por-valor_"
      : scope === "presenca"
      ? "por-presenca_"
      : "";
  const baseName = `tasy-vs-repasse_${suffix}${stamp}`;


  // Fallback: enriquece PJ Conciliada / Regra / Cálculo para resultados
  // carregados do banco antes desta funcionalidade existir. Busca por
  // matched_payment_item_id → payment_items → companies / rule_calculations.
  const missing = list.filter((r) => r.matched_payment_item_id && (!r.pj_conciliada || !r.regra_aplicada || !r.calculo_aplicado));
  if (missing.length > 0) {
    try {
      const pii = Array.from(new Set(missing.map((r) => r.matched_payment_item_id!).filter(Boolean)));
      const CHUNK = 300;
      const piMap = new Map<string, { company_id?: string; applied_rule_label?: string; applied_rule_id?: string; applied_calc_id?: string }>();
      for (let i = 0; i < pii.length; i += CHUNK) {
        const { data } = await supabase
          .from("payment_items" as never)
          .select("id, company_id, applied_rule_label, applied_rule_id, applied_calc_id")
          .in("id", pii.slice(i, i + CHUNK) as never);
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          piMap.set(String(row.id), {
            company_id: row.company_id ? String(row.company_id) : undefined,
            applied_rule_label: row.applied_rule_label ? String(row.applied_rule_label) : undefined,
            applied_rule_id: row.applied_rule_id ? String(row.applied_rule_id) : undefined,
            applied_calc_id: row.applied_calc_id ? String(row.applied_calc_id) : undefined,
          });
        }
      }
      const compIds = Array.from(new Set(Array.from(piMap.values()).map((v) => v.company_id).filter(Boolean))) as string[];
      const calcIds = Array.from(new Set(Array.from(piMap.values()).map((v) => v.applied_calc_id).filter(Boolean))) as string[];
      const companyNameById = new Map<string, string>();
      const calcLabelById = new Map<string, string>();
      if (compIds.length > 0) {
        const { data: comps } = await supabase.from("companies").select("id, name").in("id", compIds);
        for (const c of comps ?? []) if (c?.id) companyNameById.set(String(c.id), String((c as { name?: string }).name ?? ""));
      }
      if (calcIds.length > 0) {
        const { data: calcs } = await supabase.from("rule_calculations").select("id, label, sort_order, calculation_type").in("id", calcIds);
        for (const c of calcs ?? []) {
          if (!c?.id) continue;
          const cc = c as { id: string; label?: string | null; sort_order?: number | null; calculation_type?: string | null };
          const label = (cc.label ?? "").trim();
          const idx = typeof cc.sort_order === "number" ? cc.sort_order + 1 : null;
          const method = cc.calculation_type ?? "";
          calcLabelById.set(String(cc.id), [idx ? `#${idx}` : "", label, method ? `(${method})` : ""].filter(Boolean).join(" "));
        }
      }
      for (const r of missing) {
        const info = piMap.get(r.matched_payment_item_id!);
        if (!info) continue;
        if (!r.pj_conciliada && info.company_id) r.pj_conciliada = companyNameById.get(info.company_id) || undefined;
        if (!r.regra_aplicada && info.applied_rule_label) r.regra_aplicada = info.applied_rule_label;
        if (!r.calculo_aplicado && info.applied_calc_id) r.calculo_aplicado = calcLabelById.get(info.applied_calc_id) || undefined;
        if (!r.matched_company_id && info.company_id) r.matched_company_id = info.company_id;
        if (!r.applied_rule_id && info.applied_rule_id) r.applied_rule_id = info.applied_rule_id;
        if (!r.applied_calc_id && info.applied_calc_id) r.applied_calc_id = info.applied_calc_id;
      }
    } catch (e) {
      console.warn("Falha ao enriquecer PJ/regra no export:", e);
    }
  }


  if (fmt === "json") {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baseName}.json`; a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const XLSX = await import("xlsx");

  if (fmt === "csv") {
    // CSV não suporta merge, então usa cabeçalho único com o grupo colado.
    const rows = buildExportRows(list);
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baseName}.csv`; a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // ============================================================
  // XLSX com estilos reais (xlsx-js-style). Ganhos de leitura:
  //  · linha 1 = título do grupo com fundo colorido por natureza
  //  · linha 2 = cabeçalho da coluna, negrito, mesmo tom mais claro
  //  · corpo   = número formatado (R$ / qtd), bordas suaves entre grupos
  //  · freeze de 2 linhas + 2 colunas para bater o olho sem perder o contexto
  // A biblioteca community `xlsx` ignora a chave `s` no writeFile, por isso
  // trocamos para `xlsx-js-style` (fork com mesma API que preserva estilo).
  // ============================================================
  const XLSXStyle = await import("xlsx-js-style");

  // Paleta por grupo — tons pastel legíveis e alinhados à leitura visual da UI.
  // Header (linha 1) = tom mais forte; sub-header (linha 2) = tom claro.
  // Paleta suave: headers em tons pastel legíveis, texto escuro. Evita saturação forte.
  const GROUP_STYLE: Record<string, { header: string; sub: string; band: string }> = {
    "Item":                                       { header: "E2E8F0", sub: "F1F5F9", band: "FAFBFC" },
    "Contexto":                                   { header: "DBEAFE", sub: "EFF6FF", band: "F8FBFF" },
    "TASY hoje (100% convênio)":                  { header: "FEF3C7", sub: "FEFCE8", band: "FFFDF5" },
    "Lote histórico":                             { header: "EDE9FE", sub: "F5F3FF", band: "FBFAFF" },
    "Diferenças brutas (TASY hoje − lote)":       { header: "FFE4E6", sub: "FFF1F2", band: "FFF8F9" },
    "Devido hoje (acordo × TASY hoje)":           { header: "D1FAE5", sub: "ECFDF5", band: "F6FDFA" },
    "Ajuste (pago no lote − devido hoje)":        { header: "FED7AA", sub: "FFEDD5", band: "FFF7EC" },
    "Ação sugerida":                              { header: "E0E7FF", sub: "EEF2FF", band: "F5F7FF" },
    "Rastreio":                                   { header: "E2E8F0", sub: "F1F5F9", band: "F8FAFC" },
  };
  const fallbackStyle = { header: "E2E8F0", sub: "F1F5F9", band: "FFFFFF" };
  // Texto escuro para todos os headers (sem branco sobre cor saturada).
  const HEADER_TEXT = "334155";
  const BORDER_SOFT = "CBD5E1";

  // Formato numérico por header. R$ em contabilidade, quantidade com 4 casas
  // quando é fracionada. Zero vira "—" para não poluir a leitura.
  const MONEY_FMT = '_-"R$" * #,##0.00_-;[Red]-"R$" * #,##0.00_-;_-"R$" * "—"_-;_-@_-';
  const QTY_FMT = '0.####;-0.####;"—"';
  const numFmtFor = (header: string): string | null => {
    const h = header.toLowerCase();
    if (h.includes("qtd") || h.startsWith("dif. quant") || h.includes("nº")) return QTY_FMT;
    if (
      h.startsWith("vlr") || h.startsWith("valor") || h.startsWith("base") ||
      h.startsWith("pago") || h.startsWith("dif. valor") || h.startsWith("ajuste") ||
      h.startsWith("a recuperar") || h.startsWith("a complementar")
    ) return MONEY_FMT;
    return null;
  };

  // Constrói uma aba de dados a partir de uma sub-lista. Extraído em helper
  // para permitir gerar duas abas ("Por valor" e "Por presença") no mesmo
  // arquivo respeitando os filtros correntes.
  const buildDataSheet = (subList: TvrResult[]) => {
    // AoA: linha 0 = grupo, linha 1 = header, restante = dados.
    const groupRow = EXPORT_COLS.map((c) => c.group);
    const headerRow = EXPORT_COLS.map((c) => c.header);
    const dataRows = subList.map((r) => EXPORT_COLS.map((c) => c.get(r)));
    const aoa: (string | number)[][] = [groupRow, headerRow, ...dataRows];
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

    const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
    let groupStart = 0;
    for (let i = 1; i <= EXPORT_COLS.length; i++) {
      const isEnd = i === EXPORT_COLS.length || EXPORT_COLS[i].group !== EXPORT_COLS[groupStart].group;
      if (isEnd) {
        if (i - 1 > groupStart) merges.push({ s: { r: 0, c: groupStart }, e: { r: 0, c: i - 1 } });
        groupStart = i;
      }
    }
    (ws as unknown as { "!merges"?: unknown[] })["!merges"] = merges;
    (ws as unknown as { "!freeze"?: unknown })["!freeze"] = { xSplit: 2, ySplit: 2 };
    (ws as unknown as { "!views"?: unknown[] })["!views"] = [{ state: "frozen", xSplit: 2, ySplit: 2, topLeftCell: "C3", activePane: "bottomRight" }];

    const widths: Array<{ wch: number }> = EXPORT_COLS.map((c) => {
      const h = c.header.toLowerCase();
      if (h.startsWith("id ") || h.includes("chave canônica")) return { wch: 38 };
      if (h.includes("procedimento") || h.includes("paciente") || h.includes("quais")) return { wch: 34 };
      if (h.includes("médico") || h.includes("pj") || h.includes("regra") || h.includes("motivo") || h.includes("linha do")) return { wch: 28 };
      if (h.includes("convênio") || h.includes("lote")) return { wch: 22 };
      if (numFmtFor(c.header)) return { wch: 18 };
      if (h.includes("data") || h.includes("função") || h.includes("status") || h.includes("tipo")) return { wch: 15 };
      if (h.includes("qtd") || h.includes("nº")) return { wch: 11 };
      return { wch: 20 };
    });
    (ws as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = widths;
    (ws as unknown as { "!rows"?: Array<{ hpt?: number }> })["!rows"] = [{ hpt: 26 }];

    const totalRows = aoa.length;
    const thinBorder = { style: "thin", color: { rgb: "E2E8F0" } };
    for (let c = 0; c < EXPORT_COLS.length; c++) {
      const col = EXPORT_COLS[c];
      const palette = GROUP_STYLE[col.group] ?? fallbackStyle;
      const prevGroup = c > 0 ? EXPORT_COLS[c - 1].group : null;
      const isGroupStart = prevGroup !== col.group;
      const fmt = numFmtFor(col.header);

      const gAddr = XLSXStyle.utils.encode_cell({ r: 0, c });
      if (ws[gAddr]) {
        (ws[gAddr] as { s?: unknown }).s = {
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          font: { bold: true, color: { rgb: HEADER_TEXT }, sz: 11 },
          fill: { patternType: "solid", fgColor: { rgb: palette.header } },
          border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
        };
      }
      const hAddr = XLSXStyle.utils.encode_cell({ r: 1, c });
      if (ws[hAddr]) {
        (ws[hAddr] as { s?: unknown }).s = {
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          font: { bold: true, color: { rgb: HEADER_TEXT }, sz: 10 },
          fill: { patternType: "solid", fgColor: { rgb: palette.sub } },
          border: {
            top: thinBorder,
            bottom: { style: "thin", color: { rgb: BORDER_SOFT } },
            left: isGroupStart ? { style: "thin", color: { rgb: BORDER_SOFT } } : thinBorder,
            right: thinBorder,
          },
        };
      }
      for (let r = 2; r < totalRows; r++) {
        const addr = XLSXStyle.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        // Corpo neutro: só cabeçalhos recebem cor de grupo; linhas alternam branco/cinza muito claro.
        const zebra = r % 2 === 0 ? "FFFFFF" : "F8FAFC";
        (cell as { s?: unknown; z?: string; t?: string }).s = {
          alignment: { horizontal: fmt ? "right" : "left", vertical: "top", wrapText: true },
          font: { sz: 10, color: { rgb: "1E293B" } },
          fill: { patternType: "solid", fgColor: { rgb: zebra } },
          border: {
            top: { style: "hair", color: { rgb: "EEF2F6" } },
            bottom: { style: "hair", color: { rgb: "EEF2F6" } },
            left: isGroupStart ? { style: "thin", color: { rgb: BORDER_SOFT } } : { style: "hair", color: { rgb: "F1F5F9" } },
            right: { style: "hair", color: { rgb: "F1F5F9" } },
          },
        };
        if (fmt) {
          (cell as { z?: string }).z = fmt;
          if (typeof cell.v === "number") (cell as { t: string }).t = "n";
        }
      }
    }
    return ws;
  };

  // Modo split: duas abas (Por valor / Por presença) no mesmo arquivo,
  // ambas respeitando busca + status + apenas com pagamento.
  const isSplit = scope === "split";
  const listValor = isSplit ? list.filter((r) => r.tipo_analise === "valor") : [];
  const listPresenca = isSplit ? list.filter((r) => r.tipo_analise === "quantidade") : [];
  // Fix C — no split, SEMPRE geramos as duas abas (mesmo que uma esteja
  // vazia), para o analista enxergar que a categoria não tem itens em vez
  // de achar que o export bugou. Placeholder = header + linha vazia.
  const buildEmptyPlaceholder = (label: string) => {
    const groupRow = EXPORT_COLS.map((c) => c.group);
    const headerRow = EXPORT_COLS.map((c) => c.header);
    const emptyRow: (string | number)[] = [
      `Sem itens de "${label}" com os filtros atuais.`,
      ...EXPORT_COLS.slice(1).map(() => ""),
    ];
    const aoa: (string | number)[][] = [groupRow, headerRow, emptyRow];
    return XLSXStyle.utils.aoa_to_sheet(aoa);
  };
  const ws = isSplit ? null : buildDataSheet(list);
  const wsValor = isSplit ? (listValor.length > 0 ? buildDataSheet(listValor) : buildEmptyPlaceholder("Por valor")) : null;
  const wsPresenca = isSplit ? (listPresenca.length > 0 ? buildDataSheet(listPresenca) : buildEmptyPlaceholder("Por presença")) : null;


  // ============================================================
  // Aba "Legenda": vem antes da aba de dados para funcionar como
  // manual rápido. Duas seções: (1) glossário de conceitos que aparecem
  // no relatório e (2) dicionário de todas as colunas exportadas.
  // ============================================================
  const CONCEPT_GLOSSARY: Array<[string, string]> = [
    ["TASY hoje", "Estado atual da base do hospital (TASY). Reflete cancelamentos, glosas e correções feitas depois do repasse original."],
    ["Lote histórico", "Lote de repasse já processado e pago em competência anterior. Base 100% do convênio e valor pago ao médico registrados na época."],
    ["Base convênio (100%)", "Valor cheio da tabela do convênio para o procedimento — antes de aplicar qualquer acordo/percentual com o médico."],
    ["Pago ao médico (c/ acordo)", "Valor que o médico efetivamente recebeu naquele item, já com o percentual do acordo aplicado sobre a base."],
    ["Devido hoje", "Quanto o médico deveria receber HOJE se o motor reprocessasse o item com a base atual do TASY e o mesmo acordo do lote original."],
    ["Ajuste (pago no lote − devido hoje)", "Diferença entre o que foi pago e o que seria devido hoje. Positivo = pagamos a mais (recuperar). Negativo = pagamos a menos (complementar)."],
    ["A recuperar", "Valor que precisa voltar do médico porque o TASY reduziu a base (glosa/cancelamento) depois do repasse."],
    ["A complementar", "Valor extra a pagar ao médico porque o TASY aumentou a base ou apareceu item novo depois do repasse."],
    ["Ação sugerida", "Resumo em linguagem do analista do que fazer com o item — deriva do sinal do ajuste e do tipo de regra aplicada."],
    ["Tipo de análise · Valor (% convênio)", "Regras percentual_convenio: TASY e Exacta compartilham a mesma base do convênio, então comparamos em R$."],
    ["Tipo de análise · Quantidade (tabela própria)", "Regras de pacote, valor fixo ou tabela diferenciada: TASY não é base de R$, então comparamos presença e quantidade."],
    ["Sem lastro TASY", "Item foi pago no lote histórico mas hoje não aparece mais na base TASY — provável cancelamento total do procedimento."],
    ["Regra aplicada", "Nome da regra do acordo cadastrado que gerou o cálculo daquele item no lote histórico."],
    ["Linha do cálculo", "Linha específica dentro da regra (quando a regra tem múltiplas linhas/faixas) que foi aplicada ao item."],
    ["PJ provável (Faltou pagar)", "Para itens sem lastro no lote, sugerimos a PJ ativa do médico (doctor_companies com end_date null). Só preenche quando existe uma única PJ ativa — regra 1 PJ por médico por hospital."],
    ["Regra prevista (Faltou pagar)", "Para itens sem lastro no lote, sugerimos a última regra já aplicada para o mesmo médico + procedure_code neste hospital (heurística). É uma indicação — não é valor pago e não roda o motor de cálculo."],
    ["Badge 'prev.'", "Marca visual na tabela indicando que aquela informação (PJ ou Regra) é INFERIDA para um item Faltou pagar, não um dado real do repasse."],
  ];

  // Descrições por coluna. Chave = header exato usado no EXPORT_COLS.
  const COLUMN_DESCRIPTIONS: Record<string, string> = {
    "Status": "Situação do item na conciliação: OK, faltou pagar, pago a mais, pago a menos, sem lastro etc.",
    "Tipo de análise": "Natureza da regra do acordo — determina se comparamos em R$ ou por presença/quantidade.",
    "Sem lastro TASY": "Marcado quando o item foi pago no lote mas hoje não existe mais na base TASY.",
    "PJ": "Empresa (pessoa jurídica) para a qual o pagamento do médico foi direcionado no lote histórico. Em itens 'Faltou pagar' mostra a PJ provável com prefixo '[prev.]' (equivalente ao badge amarelo da tela).",
    "Médico": "Nome do médico responsável pelo procedimento.",
    "Atendimento": "Número do atendimento no TASY (chave principal de vínculo entre TASY e Exacta).",
    "Cód. TUSS": "Código TUSS de 8 dígitos do procedimento.",
    "Procedimento": "Descrição textual do procedimento conforme aparece no TASY.",
    "Paciente": "Nome do paciente do atendimento (dado sensível — uso restrito à conciliação).",
    "Data": "Data do procedimento registrada no TASY.",
    "Convênio": "Convênio/plano de saúde do atendimento.",
    "Função": "Papel do médico no procedimento (Cirurgião Principal, Primeiro Auxiliar, Anestesista etc.).",
    "Qtd": "Quantidade do procedimento na base TASY atual.",
    "Vlr unitário": "Valor unitário do procedimento na tabela do convênio (100%, sem acordo) na base TASY atual.",
    "Vlr total": "Valor total do procedimento na base TASY atual (qtd × unitário, 100% convênio).",
    "Qtd paga por função": "Quantidade que foi paga ao médico neste item no lote histórico, distribuída pela função.",
    "Nº de funções pagas": "Quantas funções distintas (Cirurgião, Auxiliar…) foram pagas neste atendimento+TUSS no lote.",
    "Quais funções pagas": "Lista textual das funções que receberam pagamento neste item no lote histórico.",
    "Lote(s) de origem": "Identificador(es) do lote de repasse em que este item foi pago.",
    "Base convênio (100%, época)": "Base 100% do convênio registrada NO LOTE (época do repasse), antes do acordo.",
    "Pago ao médico (c/ acordo)": "Valor efetivamente pago ao médico neste item no lote histórico, já com o acordo aplicado.",
    "Dif. quantidade": "Quantidade TASY hoje − quantidade paga no lote. Negativa = TASY reduziu (glosa/cancelamento).",
    "Dif. valor 100%": "Vlr total TASY hoje − base convênio no lote. Mede quanto a base 100% mudou depois do repasse.",
    "Valor devido hoje": "Quanto seria pago ao médico se o motor reprocessasse hoje, com a base TASY atual e o mesmo acordo do lote.",
    "Ajuste a fazer": "Pago no lote − Valor devido hoje. Positivo = pagamos a mais (recuperar). Negativo = pagamos a menos (complementar).",
    "A recuperar (paguei a mais)": "Valor a estornar do médico porque a base TASY reduziu depois do repasse.",
    "A complementar (paguei a menos)": "Valor extra a pagar ao médico porque a base TASY aumentou depois do repasse.",
    "Ação": "Ação sugerida em linguagem do analista (recuperar / complementar / sem ajuste).",
    "Motivo": "Explicação curta do porquê da ação — geralmente cita a natureza do acordo e o que mudou no TASY.",
    "Regra aplicada": "Nome da regra do acordo cadastrado que originou o cálculo no lote. Em 'Faltou pagar' mostra a regra prevista com prefixo '[prev.]' (mesmo badge da UI).",
    "Linha do cálculo": "Linha específica da regra aplicada (útil quando a regra tem várias linhas/faixas). Em 'Faltou pagar' cai para a linha prevista com prefixo '[prev.]'.",
    "ID do lote (payment_id)": "UUID do lote de repasse (tabela payments) — cola direto na URL /financeiro/pagamentos/<id>.",
    "ID do item (payment_item_id)": "UUID do item pago dentro do lote (tabela payment_items). Chave para conciliar linha do TASY com o registro de repasse.",
    "ID da regra (rule_id)": "UUID da regra do acordo aplicada (tabela rules). Em 'Faltou pagar' devolve o UUID da regra prevista inferida — mesmo comportamento da UI.",
    "ID do cálculo (rule_calculation_id)": "UUID da linha de cálculo da regra (tabela rule_calculations). Em 'Faltou pagar' devolve o UUID da linha prevista inferida.",
    "ID da PJ (company_id)": "UUID da empresa vinculada ao item no lote histórico (tabela companies). Em 'Faltou pagar' devolve o UUID da PJ provável inferida.",
    "ID do médico (doctor_id)": "UUID do médico do procedimento (tabela doctors).",
    "Chave canônica": "Chave interna que o motor usa para cruzar TASY × Exacta (Atend + Data + TUSS8 + Médico normalizado).",
    "PJ provável (Faltou pagar)": "Empresa sugerida para itens que nunca foram pagos — usa o vínculo ativo do médico em doctor_companies (regra: 1 PJ ativa por médico por hospital). Vazio quando o médico tem múltiplas PJs ativas (ambíguo).",
    "ID PJ provável": "UUID da PJ provável (tabela companies).",
    "Regra prevista (Faltou pagar)": "Regra sugerida para itens sem pagamento — última regra já aplicada para este médico + procedure_code neste hospital. Heurística, não invoca o motor de cálculo.",
    "ID regra prevista": "UUID da regra prevista (tabela rules).",
    "Cálculo previsto": "Linha de cálculo (label #ordem) associada à regra prevista.",
    "ID cálculo previsto": "UUID da linha de cálculo prevista (tabela rule_calculations).",


  };

  // Monta AoA da legenda: título + seção conceitos + seção colunas.
  const legAoa: (string | number)[][] = [];
  legAoa.push(["Legenda — TASY vs Repasse"]);
  legAoa.push([]);
  legAoa.push(["Conceitos-chave"]);
  legAoa.push(["Termo", "Significado"]);
  for (const [term, def] of CONCEPT_GLOSSARY) legAoa.push([term, def]);
  legAoa.push([]);
  legAoa.push(["Dicionário de colunas"]);
  legAoa.push(["Grupo", "Coluna", "Descrição"]);
  for (const col of EXPORT_COLS) {
    legAoa.push([col.group, col.header, COLUMN_DESCRIPTIONS[col.header] ?? ""]);
  }

  const wsLeg = XLSXStyle.utils.aoa_to_sheet(legAoa);
  (wsLeg as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = [
    { wch: 34 }, { wch: 30 }, { wch: 90 },
  ];
  // Merges: título (linha 0) ocupa 3 colunas; "Conceitos-chave" (linha 2) ocupa 2;
  // "Dicionário de colunas" (linha após conceitos) ocupa 3.
  const legMerges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  legMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
  legMerges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } });
  const dictRow = 3 + CONCEPT_GLOSSARY.length + 2; // linha do "Dicionário de colunas"
  legMerges.push({ s: { r: dictRow, c: 0 }, e: { r: dictRow, c: 2 } });
  // Conceitos: 2ª coluna (definição) quebra linha; damos merge horizontal apenas
  // quando não há valor na 3ª coluna — não é necessário, colunas ficam como estão.
  (wsLeg as unknown as { "!merges"?: unknown[] })["!merges"] = legMerges;

  // Estilos: título grande, cabeçalhos de seção destacados, quebra de linha nas descrições.
  const setStyle = (addr: string, s: Record<string, unknown>) => {
    if (wsLeg[addr]) (wsLeg[addr] as { s?: unknown }).s = s;
  };
  setStyle("A1", {
    font: { bold: true, sz: 16, color: { rgb: "334155" } },
    alignment: { horizontal: "left", vertical: "center" },
    fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
  });
  setStyle(XLSXStyle.utils.encode_cell({ r: 2, c: 0 }), {
    font: { bold: true, sz: 12, color: { rgb: "334155" } },
    fill: { patternType: "solid", fgColor: { rgb: "DBEAFE" } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  setStyle(XLSXStyle.utils.encode_cell({ r: dictRow, c: 0 }), {
    font: { bold: true, sz: 12, color: { rgb: "334155" } },
    fill: { patternType: "solid", fgColor: { rgb: "DBEAFE" } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  // Linhas de header ("Termo/Significado" e "Grupo/Coluna/Descrição")
  const conceptHeaderRow = 3;
  const dictHeaderRow = dictRow + 1;
  for (let c = 0; c < 3; c++) {
    setStyle(XLSXStyle.utils.encode_cell({ r: conceptHeaderRow, c }), {
      font: { bold: true, color: { rgb: "1E293B" } },
      fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { bottom: { style: "thin", color: { rgb: "94A3B8" } } },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r: dictHeaderRow, c }), {
      font: { bold: true, color: { rgb: "1E293B" } },
      fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
      alignment: { horizontal: "left", vertical: "center" },
      border: { bottom: { style: "thin", color: { rgb: "94A3B8" } } },
    });
  }
  // Corpo — wrap nas colunas de definição/descrição para textos longos aparecerem inteiros.
  for (let r = conceptHeaderRow + 1; r < conceptHeaderRow + 1 + CONCEPT_GLOSSARY.length; r++) {
    setStyle(XLSXStyle.utils.encode_cell({ r, c: 0 }), {
      font: { bold: true, sz: 10, color: { rgb: "1E293B" } },
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r, c: 1 }), {
      font: { sz: 10, color: { rgb: "334155" } },
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
    });
  }
  for (let r = dictHeaderRow + 1; r < dictHeaderRow + 1 + EXPORT_COLS.length; r++) {
    setStyle(XLSXStyle.utils.encode_cell({ r, c: 0 }), {
      font: { sz: 10, color: { rgb: "6D28D9" }, bold: true },
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r, c: 1 }), {
      font: { sz: 10, color: { rgb: "1E293B" }, bold: true },
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
    });
    setStyle(XLSXStyle.utils.encode_cell({ r, c: 2 }), {
      font: { sz: 10, color: { rgb: "334155" } },
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
    });
  }

  // ============================================================
  // Aba "Parâmetros de cálculo": parâmetros brutos da regra/linha de cálculo
  // aplicada (e da regra prevista, quando existir) para cada item, mapeados
  // por payment_item_id / rule_id / rule_calculation_id. Permite auditar
  // fator, %, base e ver de qual cadastro o motor puxou.
  // ============================================================
  const wsParams = await (async () => {
    // Coleta todos os calc_ids envolvidos: aplicados e previstos.
    const allCalcIds = new Set<string>();
    const allRuleIds = new Set<string>();
    for (const r of list) {
      if (r.applied_calc_id) allCalcIds.add(String(r.applied_calc_id));
      if (r.calculo_previsto_id) allCalcIds.add(String(r.calculo_previsto_id));
      if (r.applied_rule_id) allRuleIds.add(String(r.applied_rule_id));
      if (r.regra_prevista_id) allRuleIds.add(String(r.regra_prevista_id));
    }

    const calcById = new Map<string, Record<string, unknown>>();
    const ruleNameById = new Map<string, string>();
    try {
      const CHUNK = 200;
      const calcIdsArr = Array.from(allCalcIds);
      for (let i = 0; i < calcIdsArr.length; i += CHUNK) {
        const slice = calcIdsArr.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("rule_calculations")
          .select(
            "id, rule_id, sort_order, label, calculation_type, application_unit, fixed_amount, target_amount, multiplier, deflator_pct, bonus_amount, bonus_pct, repasse_pct, convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, include_auxiliaries, package_amount, package_subtype, package_main_code, reference_table_id, acrescimo_pct, adicional_fds_pct, adicional_feriado_pct, adicional_noturno_pct, adicional_urgencia_pct",
          )
          .in("id", slice);
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          if (row?.id) {
            calcById.set(String(row.id), row);
            if (row.rule_id) allRuleIds.add(String(row.rule_id));
          }
        }
      }
      const ruleIdsArr = Array.from(allRuleIds);
      for (let i = 0; i < ruleIdsArr.length; i += CHUNK) {
        const slice = ruleIdsArr.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("rules")
          .select("id, name, code, calculation_type")
          .in("id", slice);
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          if (row?.id) {
            const nm = [row.code ? `[${row.code}]` : "", row.name ?? ""].filter(Boolean).join(" ").trim();
            ruleNameById.set(String(row.id), nm);
          }
        }
      }
    } catch (e) {
      console.warn("Falha ao carregar parâmetros de cálculo:", e);
    }

    const paramCols: Array<{ header: string; get: (calc: Record<string, unknown> | undefined) => string | number }> = [
      { header: "Tipo de cálculo",       get: (c) => (c?.calculation_type as string) ?? "" },
      { header: "Unidade de aplicação",  get: (c) => (c?.application_unit as string) ?? "" },
      { header: "Repasse %",             get: (c) => Number(c?.repasse_pct ?? 0) },
      { header: "Convênio %",            get: (c) => Number(c?.convenio_percentage ?? 0) },
      { header: "Multiplicador",         get: (c) => Number(c?.multiplier ?? 0) },
      { header: "Deflator %",            get: (c) => Number(c?.deflator_pct ?? 0) },
      { header: "Acréscimo %",           get: (c) => Number(c?.acrescimo_pct ?? 0) },
      { header: "Valor fixo",            get: (c) => Number(c?.fixed_amount ?? 0) },
      { header: "Valor alvo",            get: (c) => Number(c?.target_amount ?? 0) },
      { header: "Valor pacote",          get: (c) => Number(c?.package_amount ?? 0) },
      { header: "Bônus R$",              get: (c) => Number(c?.bonus_amount ?? 0) },
      { header: "Bônus %",               get: (c) => Number(c?.bonus_pct ?? 0) },
      { header: "Aux 1º %",              get: (c) => Number(c?.aux_first_pct ?? 0) },
      { header: "Aux 2º %",              get: (c) => Number(c?.aux_second_pct ?? 0) },
      { header: "Auxiliar %",            get: (c) => Number(c?.auxiliary_pct ?? 0) },
      { header: "Instrumentador %",      get: (c) => Number(c?.instrumentador_pct ?? 0) },
      { header: "Ad. FDS %",             get: (c) => Number(c?.adicional_fds_pct ?? 0) },
      { header: "Ad. Feriado %",         get: (c) => Number(c?.adicional_feriado_pct ?? 0) },
      { header: "Ad. Noturno %",         get: (c) => Number(c?.adicional_noturno_pct ?? 0) },
      { header: "Ad. Urgência %",        get: (c) => Number(c?.adicional_urgencia_pct ?? 0) },
      { header: "Pacote (subtype)",      get: (c) => (c?.package_subtype as string) ?? "" },
      { header: "Pacote (main code)",    get: (c) => (c?.package_main_code as string) ?? "" },
      { header: "Ref. table id",         get: (c) => (c?.reference_table_id as string) ?? "" },
    ];

    const fixedCols = [
      "Origem", "Atendimento", "TUSS", "Médico", "PJ",
      "payment_id", "payment_item_id", "rule_id", "Nome da regra",
      "rule_calculation_id", "Linha do cálculo",
      "Base aplicada (R$)", "Pago ao médico no lote (R$)", "Devido hoje (R$)",
    ];
    const headerRowP = [...fixedCols, ...paramCols.map((p) => p.header)];

    const bodyRows: (string | number)[][] = [];
    for (const r of list) {
      // Linha para regra APLICADA (quando o item foi pago no lote).
      if (r.applied_calc_id || r.applied_rule_id) {
        const calc = r.applied_calc_id ? calcById.get(String(r.applied_calc_id)) : undefined;
        const ruleId = String(r.applied_rule_id ?? calc?.rule_id ?? "");
        const idx = typeof calc?.sort_order === "number" ? (calc.sort_order as number) + 1 : null;
        const linha = [idx ? `#${idx}` : "", (calc?.label as string) ?? r.calculo_aplicado ?? ""].filter(Boolean).join(" ").trim();
        bodyRows.push([
          "aplicada",
          r.atendimento ?? "",
          r.tuss ?? "",
          r.medico ?? "",
          r.pj_conciliada ?? "",
          r.matched_payment_id ?? "",
          r.matched_payment_item_id ?? "",
          ruleId,
          ruleNameById.get(ruleId) ?? r.regra_aplicada ?? "",
          r.applied_calc_id ?? "",
          linha,
          Number(r.valor_pago_base ?? 0),
          Number(r.valor_com_acordo ?? 0),
          Number(r.valor_com_acordo_recalc ?? 0),
          ...paramCols.map((p) => p.get(calc)),
        ]);
      }
      // Linha para regra PREVISTA (heurística para Faltou pagar).
      if (r.calculo_previsto_id || r.regra_prevista_id) {
        const calc = r.calculo_previsto_id ? calcById.get(String(r.calculo_previsto_id)) : undefined;
        const ruleId = String(r.regra_prevista_id ?? calc?.rule_id ?? "");
        const idx = typeof calc?.sort_order === "number" ? (calc.sort_order as number) + 1 : null;
        const linha = [idx ? `#${idx}` : "", (calc?.label as string) ?? r.calculo_previsto ?? ""].filter(Boolean).join(" ").trim();
        bodyRows.push([
          "prevista",
          r.atendimento ?? "",
          r.tuss ?? "",
          r.medico ?? "",
          r.pj_provavel ?? "",
          "",
          "",
          ruleId,
          ruleNameById.get(ruleId) ?? r.regra_prevista ?? "",
          r.calculo_previsto_id ?? "",
          linha,
          0,
          0,
          0,
          ...paramCols.map((p) => p.get(calc)),
        ]);
      }
    }

    const aoaP: (string | number)[][] = [headerRowP, ...bodyRows];
    const wsP = XLSXStyle.utils.aoa_to_sheet(aoaP);

    // Larguras: IDs largos, headers curtos compactos.
    const widthsP: Array<{ wch: number }> = headerRowP.map((h) => {
      const s = String(h);
      if (s === "payment_id" || s === "payment_item_id" || s === "rule_id" || s === "rule_calculation_id" || s === "Ref. table id") return { wch: 38 };
      if (s === "Nome da regra" || s === "Linha do cálculo" || s === "Médico" || s === "PJ") return { wch: 32 };
      if (s === "Atendimento" || s === "TUSS" || s === "Origem") return { wch: 14 };
      if (s.includes("R$")) return { wch: 16 };
      return { wch: 14 };
    });
    (wsP as unknown as { "!cols"?: Array<{ wch: number }> })["!cols"] = widthsP;
    (wsP as unknown as { "!views"?: unknown[] })["!views"] = [
      { state: "frozen", xSplit: 1, ySplit: 1, topLeftCell: "B2", activePane: "bottomRight" },
    ];

    // Estilo do cabeçalho.
    for (let c = 0; c < headerRowP.length; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r: 0, c });
      if (wsP[addr]) {
        (wsP[addr] as { s?: unknown }).s = {
          font: { bold: true, color: { rgb: "334155" }, sz: 10 },
          fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: { bottom: { style: "thin", color: { rgb: "CBD5E1" } } },
        };
      }
    }

    // Formatos: % nas colunas de percentual, R$ nos valores, contagem nos demais.
    const pctHeaders = new Set([
      "Repasse %", "Convênio %", "Deflator %", "Acréscimo %", "Bônus %",
      "Aux 1º %", "Aux 2º %", "Auxiliar %", "Instrumentador %",
      "Ad. FDS %", "Ad. Feriado %", "Ad. Noturno %",
    ]);
    const moneyHeaders = new Set([
      "Valor fixo", "Valor alvo", "Valor pacote", "Bônus R$",
      "Base aplicada (R$)", "Pago ao médico no lote (R$)", "Devido hoje (R$)",
    ]);
    const PCT_FMT = '0.00"%";-0.00"%";"—"';
    const MONEY_FMT_P = '_-"R$" * #,##0.00_-;[Red]-"R$" * #,##0.00_-;_-"R$" * "—"_-;_-@_-';
    for (let c = 0; c < headerRowP.length; c++) {
      const h = String(headerRowP[c]);
      const fmt = pctHeaders.has(h) ? PCT_FMT : moneyHeaders.has(h) ? MONEY_FMT_P : null;
      if (!fmt) continue;
      for (let rr = 1; rr <= bodyRows.length; rr++) {
        const addr = XLSXStyle.utils.encode_cell({ r: rr, c });
        if (wsP[addr]) {
          (wsP[addr] as { s?: Record<string, unknown>; z?: string; t?: string }).z = fmt;
          (wsP[addr] as { t?: string }).t = "n";
        }
      }
    }

    return wsP;
  })();

  const wb = XLSXStyle.utils.book_new();
  // Legenda vem primeiro para servir como manual ao abrir o arquivo.
  XLSXStyle.utils.book_append_sheet(wb, wsLeg, "Legenda");
  if (isSplit) {
    // Duas abas separadas — nomes espelham as sub-abas da UI.
    if (wsValor) XLSXStyle.utils.book_append_sheet(wb, wsValor, `Por valor (${listValor.length})`);
    if (wsPresenca) XLSXStyle.utils.book_append_sheet(wb, wsPresenca, `Por presença (${listPresenca.length})`);
  } else if (ws) {
    XLSXStyle.utils.book_append_sheet(wb, ws, "TASY vs Repasse");
  }
  XLSXStyle.utils.book_append_sheet(wb, wsParams, "Parâmetros de cálculo");
  XLSXStyle.writeFile(wb, `${baseName}.xlsx`);
}
