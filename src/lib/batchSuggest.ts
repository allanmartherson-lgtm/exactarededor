import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

export interface SuggestedBatch {
  key: string;
  label: string;
  items: PaymentItemRow[];
  avgDeviation: number;
  totalAmount: number;
}

const MIN_GROUP_SIZE = 3;
const MAX_SUGGESTIONS = 5;

/**
 * Agrupa itens reprovados/alerta por padrão similar (mesmo procedimento + empresa).
 * Ignora itens acatados ou com exceção autorizada.
 * Retorna apenas grupos com 3+ itens, ordenados por tamanho.
 */
export function groupItemsByPattern(items: PaymentItemRow[]): SuggestedBatch[] {
  const eligible = items.filter(
    (i) =>
      (i.ai_status === "reprovado" || i.ai_status === "alerta") &&
      !i.authorized_exception,
  );

  const buckets = new Map<string, PaymentItemRow[]>();
  for (const it of eligible) {
    const code = (it.procedure_code ?? "").trim();
    const company = (it.company_name ?? "").trim();
    if (!code || !company) continue;
    const key = `procedure_code:${code}:company:${company}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(it);
    buckets.set(key, bucket);
  }

  const batches: SuggestedBatch[] = [];
  for (const [key, groupItems] of buckets) {
    if (groupItems.length < MIN_GROUP_SIZE) continue;

    const deviations: number[] = [];
    let totalAmount = 0;
    for (const it of groupItems) {
      const gross = Number(it.gross_amount ?? 0);
      const expected = Number(it.expected_amount ?? 0);
      totalAmount += gross;
      if (expected > 0) deviations.push((gross - expected) / expected);
    }
    const avgDeviation = deviations.length
      ? deviations.reduce((a, b) => a + b, 0) / deviations.length
      : 0;

    const first = groupItems[0];
    const code = (first.procedure_code ?? "").trim();
    const company = (first.company_name ?? "").trim();
    const devPct = (avgDeviation * 100).toFixed(0);
    const sign = avgDeviation >= 0 ? "+" : "";
    const label = `${groupItems.length} itens · código ${code} · ${company} · desvio médio ${sign}${devPct}%`;

    batches.push({ key, label, items: groupItems, avgDeviation, totalAmount });
  }

  batches.sort((a, b) => b.items.length - a.items.length);
  return batches.slice(0, MAX_SUGGESTIONS);
}
