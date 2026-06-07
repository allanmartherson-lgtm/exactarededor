/**
 * Tipos discriminados para evitar cruzamento de dados entre os modos
 * Análise e Confecção sobre a tabela `payment_items` compartilhada.
 *
 * Regra do projeto:
 *  - Análise: base hospitalar TRAZ valor pago (gross_amount) e o motor compara
 *    com o esperado (expected_amount), produzindo diferenca_regra.
 *  - Confecção: base só tem valor bruto/tabela (procedure_amount). O sistema
 *    GERA o repasse (expected_amount). gross_amount / diferenca_regra NÃO
 *    devem ser preenchidos — não há "pago real" para comparar.
 *
 * Estes tipos NÃO alteram o schema do banco. São barreiras no código:
 * loaders devolvem o tipo correto e mutações passam por `stripForMode`
 * antes de irem ao Supabase.
 */
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

export type AnalysisMode = "analise" | "confeccao";

/** Campos que SÓ fazem sentido em Análise. */
export const ANALISE_ONLY_FIELDS = [
  "gross_amount",
  "diferenca_regra",
  "valor_pago_exacta",
  "valor_repasse_acordo",
] as const satisfies ReadonlyArray<keyof PaymentItemRow>;

/** Campos que SÓ fazem sentido em Confecção. */
export const CONFECCAO_ONLY_FIELDS = [] as const satisfies ReadonlyArray<keyof PaymentItemRow>;

type AnaliseOnlyKey = (typeof ANALISE_ONLY_FIELDS)[number];

/** Item em modo Análise: mantém todos os campos comparativos. */
export type AnaliseItem = PaymentItemRow & { __mode?: "analise" };

/** Item em modo Confecção: campos comparativos vêm `null` por contrato. */
export type ConfeccaoItem = Omit<PaymentItemRow, AnaliseOnlyKey> & {
  __mode?: "confeccao";
} & {
  [K in AnaliseOnlyKey]: null;
};

export type PaymentItemByMode<M extends AnalysisMode> = M extends "confeccao"
  ? ConfeccaoItem
  : AnaliseItem;

export function isConfeccaoItem(item: PaymentItemRow, mode: AnalysisMode): item is ConfeccaoItem {
  return mode === "confeccao";
}

/**
 * Remove campos do modo errado antes de persistir. Usar em qualquer
 * mutate/update de payment_items que aceite o item completo.
 */
export function stripForMode<T extends Partial<PaymentItemRow>>(
  patch: T,
  mode: AnalysisMode,
): T {
  if (mode !== "confeccao") return patch;
  const copy: Record<string, unknown> = { ...patch };
  for (const f of ANALISE_ONLY_FIELDS) {
    if (f in copy) copy[f] = null;
  }
  return copy as T;
}

/** Coerce de uma row do banco para o tipo correto do modo atual. */
export function asItemForMode<M extends AnalysisMode>(
  row: PaymentItemRow,
  mode: M,
): PaymentItemByMode<M> {
  if (mode === "confeccao") {
    const copy: Record<string, unknown> = { ...row };
    for (const f of ANALISE_ONLY_FIELDS) copy[f] = null;
    return copy as PaymentItemByMode<M>;
  }
  return row as PaymentItemByMode<M>;
}
