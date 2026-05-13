/**
 * Sub-Onda 2A — Mapeamento do enum interno do motor (CalculationType + variantes
 * runtime) para os 8 valores estáveis gravados em payment_items.applied_calc_method.
 *
 * Este mapeamento é o ESPELHO em TypeScript da função SQL
 * public.map_calculation_type_to_method(). Qualquer mudança AQUI deve refletir LÁ
 * (e vice-versa) — o CHECK constraint do banco vai rejeitar qualquer valor fora
 * dos 8 abaixo.
 *
 * COLAPSOS importantes para quem mexer no motor:
 *   - pacote / pacote_fechado / pacote_com_extras / pacote_por_atendimento /
 *     pacote_fixo  →  'pacote'
 *     (variantes operacionais do motor; o detalhe permanece em
 *     ai_findings.calculation_breakdown / engine.calculation_type_used)
 *   - tabela_diferenciada / tabela_referencia  →  'tabela_diferenciada'
 *     (tabela_referencia é nome legado da mesma lógica)
 *   - informativo / default_geral / default_hemodinamica / desconhecido  →  null
 *     (não há método de cálculo aplicado; coluna fica NULL)
 */
export type AppliedCalcMethod =
  | "percentual_convenio"
  | "regra_vias"
  | "pacote"
  | "valor_fixo"
  | "tabela_diferenciada"
  | "bonus"
  | "complemento"
  | "exclusao";

export const APPLIED_CALC_METHOD_VALUES: ReadonlyArray<AppliedCalcMethod> = [
  "percentual_convenio",
  "regra_vias",
  "pacote",
  "valor_fixo",
  "tabela_diferenciada",
  "bonus",
  "complemento",
  "exclusao",
];

export function mapCalculationTypeToMethod(
  ctype: string | null | undefined,
): AppliedCalcMethod | null {
  if (!ctype) return null;
  switch (ctype) {
    case "pacote":
    case "pacote_fechado":
    case "pacote_com_extras":
    case "pacote_por_atendimento":
    case "pacote_fixo":
      return "pacote";
    case "tabela_diferenciada":
    case "tabela_referencia":
      return "tabela_diferenciada";
    case "percentual_sobre_convenio":
      return "percentual_convenio";
    case "regra_vias":
      return "regra_vias";
    case "valor_fixo":
      return "valor_fixo";
    case "bonus":
      return "bonus";
    case "complemento":
      return "complemento";
    case "exclusao":
      return "exclusao";
    // 'informativo', 'default_geral', 'default_hemodinamica', e qualquer outro:
    default:
      return null;
  }
}
