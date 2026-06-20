/**
 * Status simplificado para itens em MODO CONFECÇÃO.
 *
 * Em confecção a base ainda não passou por análise/aprovação — o que importa
 * é apenas se o MOTOR conseguiu calcular o repasse esperado. Os status de
 * análise (`aprovado`, `pendente`, `glosa`, `reprovado`, `alerta`, `acatado`…)
 * não fazem sentido aqui e confundem o analista, que está apenas
 * conferindo/ajustando a base antes de mandar para análise.
 *
 * Os 3 estados objetivos:
 * - `com_regra`   → motor casou uma regra e calculou `expected_amount`.
 * - `sem_regra`   → nenhuma regra cobriu (item ficará bloqueado ao finalizar).
 * - `divergente`  → motor casou regra mas algo ficou inconsistente (cálculo
 *                   incompleto, conflito de regras, código fora da lista
 *                   esperada, etc.) — analista precisa olhar.
 */
export type ConfeccaoStatus = "com_regra" | "sem_regra" | "divergente";

export type ConfeccaoStatusInput = {
  applied_rule_id?: string | null;
  applied_calc_method?: string | null;
  expected_amount?: number | string | null;
  procedure_amount?: number | string | null;
  ai_status?: string | null;
  sem_regra?: boolean | null;
  is_cancelled?: boolean | null;
  ai_findings?: { matched_priority?: string | null } | Record<string, unknown> | null;
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export const CONFECCAO_STATUS_LABEL: Record<ConfeccaoStatus, string> = {
  com_regra: "com regra",
  sem_regra: "sem regra",
  divergente: "divergente",
};

export const CONFECCAO_STATUS_TONE: Record<ConfeccaoStatus, "success" | "warning" | "destructive"> = {
  com_regra: "success",
  sem_regra: "destructive",
  divergente: "warning",
};

/** Deriva o status simplificado para a UI de confecção. Pura, sem efeitos. */
export function deriveConfeccaoStatus(item: ConfeccaoStatusInput): ConfeccaoStatus {
  const findings = (item.ai_findings ?? {}) as { matched_priority?: string | null };
  const priority = findings?.matched_priority ?? null;

  // Marcas explícitas de ausência de regra têm prioridade.
  if (item.sem_regra === true || priority === "sem_regra") return "sem_regra";
  if (!item.applied_rule_id) return "sem_regra";

  // Motor sinalizou conflito ou erro de duplicidade de cálculo → divergente.
  if (priority === "conflito") return "divergente";
  if (item.ai_status === "erro_duplicidade_calculo") return "divergente";

  const expected = toNum(item.expected_amount);
  const procedure = toNum(item.procedure_amount);

  // Regra casou mas motor não produziu valor calculado → divergente
  // (exceto quando a regra é informativa/sem cálculo monetário e o item
  // tem valor de procedimento — tratamos como com_regra).
  if (expected == null) {
    if (item.applied_calc_method && procedure != null && procedure > 0) return "com_regra";
    return "divergente";
  }

  return "com_regra";
}
