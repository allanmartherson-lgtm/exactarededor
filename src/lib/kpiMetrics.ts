/**
 * Cálculos puros das métricas da página /kpis.
 * Extraído para permitir testes unitários determinísticos sem precisar
 * montar a UI inteira.
 */
import type { PaymentStatus } from "@/lib/status";

export interface PaymentLite {
  id: string;
  status: PaymentStatus;
  total_amount: number | string;
  liquido_total?: number | string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  validated_at: string | null;
  created_by: string | null;
  validated_by: string | null;
  approved_by: string | null;
}

export interface ObsLite {
  payment_id: string;
  status_from: PaymentStatus | null;
  status_to: PaymentStatus | null;
  created_at: string;
}

export interface HistoryLite {
  payment_id: string;
  status_from: PaymentStatus | null;
  status_to: PaymentStatus | null;
  changed_at: string;
}

export interface InvoiceLite {
  id: string;
  status: string;
  payment_id: string;
  created_at: string;
  ai_validation: { divergences?: string[] } | null;
}

export type Metrics = {
  total: number;
  valor: number;
  ttApprov: number | null;
  ttValid: number | null;
  validadosCount: number;
  aprovadosCount: number;
  devolucoes: number;
  taxaDevolucao: number | null;
  pagos: number;
  rejeitados: number;
  taxaConclusao: number | null;
  nfTotal: number;
  nfDiv: number;
  nfConc: number;
  taxaDivergencia: number | null;
  throughput: number;
};

export const pct = (n: number, d: number): number | null =>
  d === 0 ? null : (n / d) * 100;

/**
 * Janela atual e anterior, ambas com largura = `rangeDays`.
 * Retorna ISO strings para uso em queries.
 */
export const buildWindows = (rangeDays: number, now: number = Date.now()) => {
  const ms = rangeDays * 24 * 60 * 60 * 1000;
  return {
    sinceCurr: new Date(now - ms).toISOString(),
    sincePrev: new Date(now - 2 * ms).toISOString(),
    untilPrev: new Date(now - ms).toISOString(),
  };
};

/**
 * Retorna o primeiro `changed_at` (em ms) por payment cujo `status_to`
 * satisfaz o predicado, restrito ao conjunto de pagamentos passado.
 */
export const firstTransitionByPayment = (
  history: HistoryLite[],
  paymentIds: Set<string>,
  target: (s: PaymentStatus | null) => boolean,
): Map<string, number> => {
  const byPayment = new Map<string, number>();
  for (const h of history) {
    if (!paymentIds.has(h.payment_id)) continue;
    if (!target(h.status_to)) continue;
    const t = new Date(h.changed_at).getTime();
    const prev = byPayment.get(h.payment_id);
    if (prev == null || t < prev) byPayment.set(h.payment_id, t);
  }
  return byPayment;
};

/**
 * Média de horas entre `created_at` e a primeira transição relevante.
 * Cai no campo *_at apenas como fallback quando NÃO existe transição.
 * Pagamentos sem transição e sem fallback não entram na média (não contam zero).
 */
export const computeAvgHours = (
  payments: PaymentLite[],
  transitions: Map<string, number>,
  fallbackField: "validated_at" | "approved_at" | null,
): { avg: number | null; count: number } => {
  const samples: number[] = [];
  for (const p of payments) {
    const created = new Date(p.created_at).getTime();
    let t = transitions.get(p.id);
    if (t == null && fallbackField) {
      const fb = p[fallbackField];
      if (fb) t = new Date(fb).getTime();
    }
    if (t == null) continue;
    const diff = (t - created) / 3_600_000;
    if (diff >= 0) samples.push(diff);
  }
  if (!samples.length) return { avg: null, count: 0 };
  return { avg: samples.reduce((a, b) => a + b, 0) / samples.length, count: samples.length };
};

/**
 * Variação percentual: (curr - prev) / |prev| * 100. Nula quando faltam
 * pontos OU quando o anterior é zero (evita ∞%).
 */
export const deltaPct = (curr: number | null, prev: number | null): number | null => {
  if (curr == null || prev == null) return null;
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
};

/** Variação em pontos absolutos (para métricas que já são %). */
export const deltaPoints = (curr: number | null, prev: number | null): number | null => {
  if (curr == null || prev == null) return null;
  return curr - prev;
};

export interface ComputeMetricsArgs {
  payments: PaymentLite[];
  observations: ObsLite[];
  history: HistoryLite[];
  invoices: InvoiceLite[];
  rangeDays: number;
  /** Quando true, considera todas as invoices; quando false, restringe ao conjunto de pagamentos. */
  invoicesUnscoped: boolean;
}

export const computeMetrics = ({
  payments,
  observations,
  history,
  invoices,
  rangeDays,
  invoicesUnscoped,
}: ComputeMetricsArgs): Metrics => {
  const total = payments.length;
  const valor = payments.reduce(
    (s, p) => s + Number(p.liquido_total ?? p.total_amount ?? 0),
    0,
  );
  const idSet = new Set(payments.map((p) => p.id));

  const validTransitions = firstTransitionByPayment(
    history,
    idSet,
    (s) => s === "aguardando_aprovacao",
  );
  const apprTransitions = firstTransitionByPayment(
    history,
    idSet,
    (s) => s === "aprovado" || s === "aprovado_em_revisao",
  );

  const valid = computeAvgHours(payments, validTransitions, "validated_at");
  const appr = computeAvgHours(payments, apprTransitions, "approved_at");

  const devolucoes = observations.filter(
    (o) => idSet.has(o.payment_id) && o.status_to === "devolvido_analista",
  ).length;
  const taxaDevolucao = pct(devolucoes, total);

  const pagos = payments.filter(
    (p) => p.status === "pago" || p.status === "arquivado",
  ).length;
  const rejeitados = payments.filter((p) => p.status === "rejeitado").length;
  const taxaConclusao = pct(pagos, total);

  const myInv = invoicesUnscoped
    ? invoices
    : invoices.filter((iv) => idSet.has(iv.payment_id));
  const nfTotal = myInv.length;
  const nfDiv = myInv.filter(
    (iv) =>
      iv.status === "divergente" ||
      (iv.ai_validation?.divergences?.length ?? 0) > 0,
  ).length;
  const nfConc = myInv.filter((iv) => iv.status === "conciliada").length;
  const taxaDivergencia = pct(nfDiv, nfTotal);

  return {
    total,
    valor,
    ttApprov: appr.avg,
    aprovadosCount: appr.count,
    ttValid: valid.avg,
    validadosCount: valid.count,
    devolucoes,
    taxaDevolucao,
    pagos,
    rejeitados,
    taxaConclusao,
    nfTotal,
    nfDiv,
    nfConc,
    taxaDivergencia,
    throughput: total / Math.max(rangeDays, 1),
  };
};
