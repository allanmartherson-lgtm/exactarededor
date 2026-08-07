/**
 * Construção do objeto `summary` persistido em retroactive_reconciliations.
 */
import type { TvrResult } from "./types";
import { computeTvrCounts, getAusenteTasyMissingFields } from "./status";
import { computeTvrFinancialTotals } from "./totals";

/**
 * Constrói o objeto `summary` persistido em retroactive_reconciliations a
 * cada reprocessamento TVR.
 *
 * Regra-chave (não regredir): SOBRESCREVE tudo; nunca faz merge com
 * `previousSummary`. Preserva explicitamente apenas:
 *   - `handoff` (estado de envio para confecção)
 *   - `tvr_validation_history` (append-only, truncado em 20)
 *
 * Garante que contadores de rodadas antigas (ex.: div_qtd, pago_sem_tasy)
 * jamais reapareçam por mesclagem residual.
 */
export function buildTvrReplaceSummary(
  list: TvrResult[],
  previousSummary: Record<string, unknown> | null | undefined,
  ctx: {
    tasy_file?: string;
    tasy_file_totals?: { file: number; valid: number; excluded: number; dropped: number } | null;
    tasy_dropped_examples?: Array<{ row_index: number; missing: string[] }>;
    exclude_tuss?: string;
    excluded_convenios?: string[];
    processed_at?: string;
  },
): Record<string, unknown> {
  const financial = computeTvrFinancialTotals(list);
  const tvrCounts = computeTvrCounts(list);
  const incompleteAusente = list.filter((r) => getAusenteTasyMissingFields(r).length > 0);
  const prev = (previousSummary ?? {}) as Record<string, unknown>;
  const prevHistory = Array.isArray(prev.tvr_validation_history)
    ? (prev.tvr_validation_history as Array<Record<string, unknown>>)
    : [];
  const historyEntry: Record<string, unknown> = {
    at: ctx.processed_at ?? new Date().toISOString(),
    total: list.length,
    counts: tvrCounts,
    ausente_incomplete: incompleteAusente.length,
  };
  const trimmedHistory = [...prevHistory.slice(-19), historyEntry];
  // Preserva chaves de escopo definidas no Passo 1/2 — sem elas o trigger do
  // banco (enforce_tvr_selected_payment_ids) rejeita o UPDATE pós-processamento
  // e o motor volta a misturar lotes de outros meses no reprocesso.
  const preservedScope = (prev as { scope?: unknown }).scope;
  const preservedSelectedIds = (prev as { selected_payment_ids?: unknown }).selected_payment_ids;
  const preservedSelectedLabels = (prev as { selected_payment_labels?: unknown }).selected_payment_labels;
  const preservedMultiCompanyIds = (prev as { multi_company_ids?: unknown }).multi_company_ids;
  const preservedMultiDoctorIds = (prev as { multi_doctor_ids?: unknown }).multi_doctor_ids;
  const preservedMultiLabels = (prev as { multi_labels?: unknown }).multi_labels;
  // handoff NÃO é preservado: se a apuração está encaminhada, o botão Processar
  // fica bloqueado (obriga desfazer primeiro). Se algum caminho de código chegar
  // aqui com handoff antigo, é bug — deixe cair para o próximo estado sem handoff.

  return {
    mode: "tasy_vs_repasse",
    total: list.length,
    total_gap: financial.totalComplementar,
    total_excess: financial.totalRetirar,
    tasy_file: ctx.tasy_file ?? "",
    tasy_file_totals: ctx.tasy_file_totals ?? null,
    tasy_dropped_examples: ctx.tasy_dropped_examples ?? [],
    exclude_tuss: ctx.exclude_tuss ?? "",
    excluded_convenios: ctx.excluded_convenios ?? [],
    processed_at: ctx.processed_at ?? new Date().toISOString(),
    tvr_counts: tvrCounts,
    tvr_ausente_incomplete: incompleteAusente.length,
    tvr_validation_history: trimmedHistory,
    ...(preservedScope !== undefined ? { scope: preservedScope } : {}),
    ...(preservedSelectedIds !== undefined ? { selected_payment_ids: preservedSelectedIds } : {}),
    ...(preservedSelectedLabels !== undefined ? { selected_payment_labels: preservedSelectedLabels } : {}),
    ...(preservedMultiCompanyIds !== undefined ? { multi_company_ids: preservedMultiCompanyIds } : {}),
    ...(preservedMultiDoctorIds !== undefined ? { multi_doctor_ids: preservedMultiDoctorIds } : {}),
    ...(preservedMultiLabels !== undefined ? { multi_labels: preservedMultiLabels } : {}),
  };
}
