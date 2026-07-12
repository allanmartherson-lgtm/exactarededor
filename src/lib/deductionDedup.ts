/**
 * Dedup de invocações da edge `apply-company-deductions`.
 *
 * Regra de idempotência (cliente):
 *   Para cada PJ com dívidas em andamento, o par (payment_id, company_id) só é
 *   invocado se AO MENOS UM débito da PJ ainda NÃO possui aplicação ativa
 *   (proposto/confirmado/partial/pending_manual_resolution) no lote-alvo.
 *
 * Isso garante que:
 *   1. Nunca há duplicidade — a edge função é chamada só quando há trabalho novo.
 *   2. Reexecuções em pares totalmente aplicados ficam em O(1) local e NÃO
 *      consomem crédito de Edge Function.
 */

export type GlosaAppLite = {
  payment_id: string;
  status: string;
  valor_aplicado?: number;
  applied_at?: string | null;
};

export type DebtLite = {
  id: string;
  company_id: string;
};

export type ComputePairsInput = {
  /** Débitos em andamento agrupados por company_id. */
  debtsByPj: Map<string, DebtLite[]>;
  /** Lote-alvo (mais recente aberto) escolhido para cada PJ. */
  currentByPj: Map<string, string>;
  /** Aplicações existentes indexadas por glosa_debt_id. */
  glosaAppsByDebt: Record<string, GlosaAppLite[]>;
};

export type ComputePairsResult = {
  pairsToInvoke: Map<string, { payment_id: string; company_id: string }>;
  alreadyApplied: number;
  missingLote: number;
};

const ACTIVE_STATUSES = new Set([
  "proposto",
  "confirmado",
  "partial",
  "pending_manual_resolution",
  // "postponed": a edge já processou o débito neste lote e adiou por saldo
  // insuficiente. Reinvocar produziria o mesmo resultado — tratamos como
  // "já aplicado" para dedup (economia de créditos + botão coerente).
  "postponed",
]);

export function debtAppliedAt(
  glosaAppsByDebt: Record<string, GlosaAppLite[]>,
  debtId: string,
  paymentId: string | null | undefined,
): GlosaAppLite | null {
  if (!paymentId) return null;
  const apps = glosaAppsByDebt[debtId] ?? [];
  return apps.find(
    (a) => a.payment_id === paymentId && ACTIVE_STATUSES.has(a.status),
  ) ?? null;
}

export function computePairsToInvoke(input: ComputePairsInput): ComputePairsResult {
  const { debtsByPj, currentByPj, glosaAppsByDebt } = input;
  const pairsToInvoke = new Map<string, { payment_id: string; company_id: string }>();
  let alreadyApplied = 0;
  let missingLote = 0;

  for (const [pj, debts] of debtsByPj.entries()) {
    const target = currentByPj.get(pj);
    if (!target) {
      missingLote += 1;
      continue;
    }
    let anyPending = false;
    for (const d of debts) {
      if (debtAppliedAt(glosaAppsByDebt, d.id, target)) {
        alreadyApplied += 1;
      } else {
        anyPending = true;
      }
    }
    if (anyPending) {
      pairsToInvoke.set(`${target}|${pj}`, { payment_id: target, company_id: pj });
    }
  }

  return { pairsToInvoke, alreadyApplied, missingLote };
}
