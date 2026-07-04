// Helpers puros para consumir a resposta da edge function `simulate-rule-batch`
// no contexto TVR "Faltou pagar". A simulação roda o motor REAL de cálculo
// (mesmo `analyzePaymentItems` usado em analyze-payment) sobre itens que não
// tiveram lastro no lote — devolve regra correspondente, valor esperado e
// tipo de cálculo. Aqui traduzimos isso para os campos que a UI/export do
// RetroactiveReconciliationsTab já entendem.
//
// Nada aqui persiste. O valor final só se materializa quando o item entra em
// confecção e o motor de pagamento roda de verdade. Esse helper serve para
// dar ao analista uma **previsão** (base para tomada de decisão).

export type TvrSimulationTipoAnalise = "valor" | "quantidade";

/**
 * Deriva o tipo de análise TVR a partir do `calculation_type_used` devolvido
 * pelo motor real.
 *
 * - percentual sobre convênio / exclusão → TASY e Exacta compartilham base
 *   monetária, então compara valor (R$).
 * - valor_fixo, pacote, tabela_diferenciada, bonus, tabela_referencia →
 *   TASY não é base de valor (pacote fechado, tabela própria, etc.), então
 *   comparação é por presença + quantidade.
 * - qualquer outro / desconhecido → default "quantidade" (mais conservador:
 *   evita cobrar diff de R$ sobre base incompatível).
 */
export function deriveTipoAnaliseFromCalcType(
  calculation_type?: string | null,
): TvrSimulationTipoAnalise {
  const t = (calculation_type ?? "").toLowerCase().trim();
  if (!t) return "quantidade";
  if (t === "percentual_sobre_convenio" || t === "percentual_convenio") return "valor";
  if (t === "exclusao") return "valor";
  // valor_fixo, pacote, tabela_diferenciada, tabela_referencia, bonus → quantidade
  return "quantidade";
}

/** Origem do valor previsto exibido ao analista, por ordem de confiança. */
export type TvrPrevistoSource =
  | "simulacao"   // motor real rodou e devolveu valor
  | "regra"       // preview local a partir de calc_raw do histórico
  | "historico"   // regra veio do histórico mas sem valor calculado aqui
  | "bruto"       // fallback: exibindo valor bruto TASY (não há previsão)
  | "sem_regra";  // motor rodou e não achou regra aplicável

/** Formata rótulo humano para a coluna "Origem previsão" no export. */
export function formatPrevistoSourceLabel(src?: TvrPrevistoSource | string | null): string {
  switch (src) {
    case "simulacao": return "Simulação";
    case "regra":     return "Histórico (calculado)";
    case "historico": return "Histórico (sem valor)";
    case "bruto":     return "Bruto (sem previsão)";
    case "sem_regra": return "Sem regra";
    default:          return "";
  }
}
