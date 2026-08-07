import { TVR_STATUS_LABEL, describeTvrAcao, formatTvrDate, getTvrValorRecuperar, type TvrResult } from "@/lib/tvr";
import { formatPrevistoSourceLabel } from "@/lib/tvrSimulationMapping";

// ============================================================
// Export: definimos colunas em um array único (grupo + cabeçalho + valor).
// No XLSX viramos isso em 2 linhas de cabeçalho com merge das colunas do
// mesmo grupo — no Excel isso é o formato nativo pra "agrupar sem sujar
// o nome da coluna". No CSV/JSON o grupo entra como coluna separada
// (não dá pra fazer merge), o que é mais limpo do que o antigo prefixo
// "GRUPO · Nome" que empoluía o cabeçalho em qualquer visualização.
// ============================================================
export type ExportCol = { group: string; header: string; get: (r: TvrResult) => string | number };
export const EXPORT_COLS: ExportCol[] = [
  // Item — flags de status/análise, sem duplicar PJ/médico (que agora abrem Contexto).
  { group: "Item", header: "Status", get: (r) => TVR_STATUS_LABEL[r.status] },
  { group: "Item", header: "Tipo de análise", get: (r) => r.tipo_analise === "quantidade" ? "Quantidade (tabela própria)" : "Valor (% convênio)" },
  { group: "Item", header: "Sem lastro TASY", get: (r) => r.sem_lastro_tasy ? "Sim" : "" },
  // Contexto — PJ e Médico primeiro (quem), depois atendimento/procedimento (o quê/quando).
  // "PJ" espelha a UI: mostra a PJ conciliada quando existe; para Faltou pagar
  // sem lastro, mostra a PJ provável com prefixo "[prev.]" (equivalente ao
  // badge amarelo). Assim analista abre o XLSX e enxerga o mesmo texto da tela.
  { group: "Contexto", header: "PJ", get: (r) => r.pj_conciliada ? r.pj_conciliada : (r.status === "nao_pago" && r.pj_provavel ? `[prev.] ${r.pj_provavel}` : "") },
  { group: "Contexto", header: "Médico", get: (r) => r.medico },
  { group: "Contexto", header: "Atendimento", get: (r) => r.atendimento },
  { group: "Contexto", header: "Cód. TUSS", get: (r) => r.tuss },
  { group: "Contexto", header: "Procedimento", get: (r) => r.procedimento },
  { group: "Contexto", header: "Paciente", get: (r) => r.paciente },
  { group: "Contexto", header: "Data", get: (r) => formatTvrDate(r.data) },
  { group: "Contexto", header: "Convênio", get: (r) => r.convenio },
  { group: "Contexto", header: "Função", get: (r) => r.funcao },

  // TASY hoje (100% convênio)
  { group: "TASY hoje (100% convênio)", header: "Qtd", get: (r) => r.qtd_tasy },
  { group: "TASY hoje (100% convênio)", header: "Vlr unitário", get: (r) => r.valor_unit_tasy },
  { group: "TASY hoje (100% convênio)", header: "Vlr total", get: (r) => r.valor_total_tasy },
  // Lote histórico
  { group: "Lote histórico", header: "Qtd paga por função", get: (r) => Number(r.qtd_por_func.toFixed(4)) },
  { group: "Lote histórico", header: "Nº de funções pagas", get: (r) => r.n_funcs },
  { group: "Lote histórico", header: "Quais funções pagas", get: (r) => r.funcoes_pagas },
  { group: "Lote histórico", header: "Lote(s) de origem", get: (r) => r.lotes },
  { group: "Lote histórico", header: "Base convênio (100%, época)", get: (r) => r.valor_pago_base },
  { group: "Lote histórico", header: "Pago ao médico (c/ acordo)", get: (r) => r.valor_com_acordo },
  // Diferenças brutas
  { group: "Diferenças brutas (TASY hoje − lote)", header: "Dif. quantidade", get: (r) => Number(r.dif_qtd.toFixed(4)) },
  { group: "Diferenças brutas (TASY hoje − lote)", header: "Dif. valor 100%", get: (r) => Number(r.dif_valor.toFixed(2)) },
  // Devido hoje
  { group: "Devido hoje (acordo × TASY hoje)", header: "Valor devido hoje", get: (r) => {
    // Para itens com lastro no lote usamos o recalc oficial. Para "Faltou
    // pagar" (sem lastro), caímos para valor_previsto_regra — que vem da
    // simulação (motor real) ou do preview local do histórico. Se nada
    // resolveu, devolve 0 (analista vê "sem previsão" pela coluna Origem).
    const v = r.status === "nao_pago"
      ? (typeof r.valor_previsto_regra === "number" ? r.valor_previsto_regra : (r.valor_com_acordo_recalc ?? 0))
      : (r.valor_com_acordo_recalc ?? 0);
    return Number((v ?? 0).toFixed(2));
  } },
  { group: "Devido hoje (acordo × TASY hoje)", header: "Valor previsto (simulação)", get: (r) => r.status === "nao_pago" && typeof r.valor_previsto_regra === "number" ? Number(r.valor_previsto_regra.toFixed(2)) : "" },
  // Ajuste
  { group: "Ajuste (pago no lote − devido hoje)", header: "Ajuste a fazer", get: (r) => Number((r.ajuste_acordo ?? 0).toFixed(2)) },
  { group: "Ajuste (pago no lote − devido hoje)", header: "A recuperar (paguei a mais)", get: (r) => Number(getTvrValorRecuperar(r).toFixed(2)) },
  { group: "Ajuste (pago no lote − devido hoje)", header: "A complementar (paguei a menos)", get: (r) => Number(Math.max(0, -(r.ajuste_acordo ?? 0)).toFixed(2)) },
  // Ação sugerida — mesmo texto que a UI mostra na coluna final.
  { group: "Ação sugerida", header: "Ação", get: (r) => describeTvrAcao(r).label.replace(/^[↓↑—]\s*/, "") },
  { group: "Ação sugerida", header: "Motivo", get: (r) => describeTvrAcao(r).hint },
  // Rastreabilidade — nomes amigáveis + IDs técnicos, para bater linha do
  // relatório com registro exato no banco sem precisar abrir a UI.
  // Regra/Cálculo e IDs correspondentes espelham a UI: quando não há regra
  // aplicada no lote (Faltou pagar), caem para regra/cálculo previstos com
  // marcador "[prev.]" (texto) ou o próprio UUID inferido (colunas de ID).
  { group: "Rastreio", header: "Regra aplicada", get: (r) => r.regra_aplicada ? r.regra_aplicada : (r.status === "nao_pago" && r.regra_prevista ? `[prev.] ${r.regra_prevista}` : "") },
  { group: "Rastreio", header: "Linha do cálculo", get: (r) => r.calculo_aplicado ? r.calculo_aplicado : (r.status === "nao_pago" && r.calculo_previsto ? `[prev.] ${r.calculo_previsto}` : "") },
  { group: "Rastreio", header: "ID do lote (payment_id)", get: (r) => r.matched_payment_id ?? "" },
  { group: "Rastreio", header: "ID do item (payment_item_id)", get: (r) => r.matched_payment_item_id ?? "" },
  { group: "Rastreio", header: "ID da regra (rule_id)", get: (r) => r.applied_rule_id ? r.applied_rule_id : (r.status === "nao_pago" ? (r.regra_prevista_id ?? "") : "") },
  { group: "Rastreio", header: "ID do cálculo (rule_calculation_id)", get: (r) => r.applied_calc_id ? r.applied_calc_id : (r.status === "nao_pago" ? (r.calculo_previsto_id ?? "") : "") },
  { group: "Rastreio", header: "ID da PJ (company_id)", get: (r) => r.matched_company_id ? r.matched_company_id : (r.status === "nao_pago" ? (r.pj_provavel_id ?? "") : "") },
  { group: "Rastreio", header: "ID do médico (doctor_id)", get: (r) => r.matched_doctor_id ?? "" },
  { group: "Rastreio", header: "Chave canônica", get: (r) => r.key ?? "" },
  // Inferência para itens sem lastro no lote — colunas separadas para deixar
  // claro que é sugestão (não valor real do repasse).
  { group: "Rastreio", header: "PJ provável (Faltou pagar)", get: (r) => r.pj_provavel ?? "" },
  { group: "Rastreio", header: "ID PJ provável", get: (r) => r.pj_provavel_id ?? "" },
  { group: "Rastreio", header: "Regra prevista (Faltou pagar)", get: (r) => r.regra_prevista ?? "" },
  { group: "Rastreio", header: "ID regra prevista", get: (r) => r.regra_prevista_id ?? "" },
  { group: "Rastreio", header: "Cálculo previsto", get: (r) => r.calculo_previsto ?? "" },
  { group: "Rastreio", header: "ID cálculo previsto", get: (r) => r.calculo_previsto_id ?? "" },
  // Origem da previsão (Faltou pagar): deixa claro se veio do motor real
  // (simulação — mais confiável) ou de heurística sobre histórico.
  { group: "Rastreio", header: "Origem previsão (Faltou pagar)", get: (r) => r.status === "nao_pago" ? formatPrevistoSourceLabel(r.previsto_source) : "" },
];

// Para CSV/JSON: nomes de coluna limpos com o grupo separado como coluna própria,
// em vez do prefixo "Grupo · Nome". É mais legível em qualquer editor de texto.
export const buildExportRows = (list: TvrResult[]) => list.map((r) => {
  const obj: Record<string, string | number> = {};
  for (const col of EXPORT_COLS) {
    // Usa nome curto sem prefixo. Se dois grupos tiverem colunas homônimas
    // (não é o caso hoje), o mais específico ganha — aceitável para relatório.
    obj[col.header] = col.get(r);
  }
  return obj;
});
