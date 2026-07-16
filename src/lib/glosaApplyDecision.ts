/**
 * Decisão pura de aplicação de glosas contra o líquido da PJ num lote.
 *
 * Invariante (mem://constraints/glosa-desconta-pj-nao-medico):
 * A glosa é dívida da PJ. O desconto sai do líquido da PJ no lote —
 * NUNCA depende de o médico da dívida ter itens de produção nesse lote.
 * Só a capacidade financeira da PJ pode adiar/parcializar.
 *
 * Espelha a lógica de `supabase/functions/apply-company-deductions` para
 * podermos garantir por testes que o gate "sem_producao" nunca volte.
 */

export type DebtInput = {
  id: string;
  doctor_id: string | null;
  total_debt: number;
  parcelas_default?: number | null;
  parcelas_confirmadas?: number; // já aplicadas em ciclos anteriores
  created_at?: string;
};

export type ApplicationDecision =
  | { debt_id: string; action: "proposto"; valor: number; parcela_numero: number; parcelas_total: number }
  | { debt_id: string; action: "postponed"; reason: "insufficient_net"; parcela_numero: number; parcelas_total: number; parcela_prevista?: number }
  | { debt_id: string; action: "skipped_completed" };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function decideGlosaApplications(
  debts: DebtInput[],
  capacidadeInicial: number,
  // médicos com produção no lote — recebido apenas para provar que NÃO é usado
  _doctorIdsComProducao: Set<string> = new Set(),
): { decisions: ApplicationDecision[]; capacidadeRestante: number } {
  const ordered = [...debts].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );

  const decisions: ApplicationDecision[] = [];
  let capacidade = round2(capacidadeInicial);

  for (const debt of ordered) {
    const parcelas = debt.parcelas_default ?? 12;
    const aplicadas = debt.parcelas_confirmadas ?? 0;
    const parcelaNumero = aplicadas + 1;
    if (parcelaNumero > parcelas) {
      decisions.push({ debt_id: debt.id, action: "skipped_completed" });
      continue;
    }
    const parcelaPrevista = round2(Number(debt.total_debt) / parcelas);

    // Regra de negócio (07/2026): sem aplicação parcial. Se a capacidade
    // não cobre a parcela inteira (ou está esgotada), adia integralmente.
    if (capacidade <= 0.01 || parcelaPrevista > capacidade) {
      decisions.push({
        debt_id: debt.id,
        action: "postponed",
        reason: "insufficient_net",
        parcela_numero: parcelaNumero,
        parcelas_total: parcelas,
        parcela_prevista: parcelaPrevista,
      });
      continue;
    }

    decisions.push({
      debt_id: debt.id,
      action: "proposto",
      valor: parcelaPrevista,
      parcela_numero: parcelaNumero,
      parcelas_total: parcelas,
    });
    capacidade = round2(capacidade - parcelaPrevista);
  }

  return { decisions, capacidadeRestante: capacidade };
}
