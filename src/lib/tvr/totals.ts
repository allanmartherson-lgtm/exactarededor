/**
 * Totais financeiros do relatório TVR.
 *
 * `computeTvrHeadlineTotals` é a FONTE ÚNICA dos headline numbers — cards e
 * modal de encaminhamento não devem recalcular nada inline.
 */
import type { TvrResult } from "./types";

export function getTvrValorRecuperar(r: TvrResult): number {
  const stored = r.valor_recuperar_acordo ?? 0;
  const ajuste = r.ajuste_acordo ?? 0;
  const paidOperational = r.valor_com_acordo && r.valor_com_acordo > 0.5
    ? r.valor_com_acordo
    : (r.valor_pago_base || 0);

  if (r.status === "ausente_tasy") return Math.max(0, paidOperational);

  if (r.tipo_analise === "quantidade" && r.dif_qtd < -0.5) {
    if (stored > 0.5) return stored;
    if (ajuste > 0.5) return ajuste;
    if (r.qtd_por_func > 0) {
      const deficit = Math.max(0, (r.qtd_por_func - r.qtd_tasy) / r.qtd_por_func);
      return Math.max(0, paidOperational * deficit);
    }
    return Math.max(0, paidOperational);
  }

  if (stored > 0.5) return stored;
  return ajuste > 0.5 ? ajuste : 0;
}

/**
 * Cards financeiros do relatório usam a mesma base operacional do export
 * (planilha "abas") — o que o analista efetivamente vai descontar/complementar:
 *   - Regra "valor" (% sobre convênio ou sem acordo cadastrado): base é o
 *     100% convênio (dif_valor). É o que o médico recebe/deveria receber.
 *   - Regra "quantidade" (pacote/valor_fixo/tabela_diferenciada/bonus):
 *     base é o `ajuste_acordo` — valor efetivamente pago pela qtd em excesso,
 *     não o convênio bruto (pacote não paga item a item pelo convênio).
 *   - `ausente_tasy`: paguei sem lastro TASY hoje → retirar o valor pós-regra
 *     (`valor_com_acordo`), com fallback ao `valor_pago_base` para rodadas
 *     antigas sem esse campo persistido.
 */
export function computeTvrFinancialTotals(list: TvrResult[]): { totalComplementar: number; totalRetirar: number } {
  const totalComplementar = list.reduce((sum, r) => {
    if (r.status === "ok" || r.status === "ausente_tasy") return sum;
    // "Faltou pagar" (nao_pago) só soma quando há previsão de regra
    // (simulação real ou preview do histórico). Sem previsão, o bruto TASY
    // é apenas o TETO — não é compromisso e não pode inflar o total, senão
    // gera falso positivo no card e no handoff. O teto aparece em separado
    // via `computeTvrComplementarBreakdown().tasyCeiling`.
    if (r.status === "nao_pago") {
      return typeof r.valor_previsto_regra === "number"
        ? sum + r.valor_previsto_regra
        : sum;
    }
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      return ajuste < -0.5 ? sum + Math.abs(ajuste) : sum;
    }
    return r.dif_valor > 0.5 ? sum + r.dif_valor : sum;
  }, 0);
  const totalRetirar = list.reduce((sum, r) => {
    const recuperar = getTvrValorRecuperar(r);
    if (recuperar > 0.5) return sum + recuperar;
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      return ajuste > 0.5 ? sum + ajuste : sum;
    }
    return r.dif_valor < -0.5 ? sum + Math.abs(r.dif_valor) : sum;
  }, 0);
  return { totalComplementar, totalRetirar };
}

/**
 * Recorta o "Total a complementar" em duas camadas:
 *  - `simulated`: soma dos `valor_previsto_regra` para "Faltou pagar" que já
 *    tiveram previsão calculada (motor real ou preview de histórico). Também
 *    inclui pago_a_menos/div_qtd_valor onde a diferença é confiável — esses
 *    já vêm do lote com lastro.
 *  - `tasyCeiling`: teto bruto = soma do `valor_total_tasy` dos "Faltou pagar"
 *    SEM previsão. É o máximo que aquele universo pode virar — o valor real
 *    só sai quando o item entra em confecção e o motor recalcula.
 *  - `coverage`: fração simulada / total de "Faltou pagar" (0..1). Serve
 *    para o card avisar quando a cobertura é baixa.
 */
export function computeTvrComplementarBreakdown(list: TvrResult[]): {
  simulated: number;
  tasyCeiling: number;
  naoPagoTotal: number;
  naoPagoSimulated: number;
  coverage: number; // 0..1
} {
  let simulated = 0;
  let tasyCeiling = 0;
  let naoPagoTotal = 0;
  let naoPagoSimulated = 0;
  for (const r of list) {
    if (r.status === "nao_pago") {
      naoPagoTotal += 1;
      if (typeof r.valor_previsto_regra === "number") {
        simulated += r.valor_previsto_regra;
        naoPagoSimulated += 1;
      } else {
        tasyCeiling += r.valor_total_tasy || 0;
      }
      continue;
    }
    if (r.status === "ok" || r.status === "ausente_tasy") continue;
    if (r.tipo_analise === "quantidade") {
      const ajuste = r.ajuste_acordo ?? 0;
      if (ajuste < -0.5) simulated += Math.abs(ajuste);
    } else if (r.dif_valor > 0.5) {
      simulated += r.dif_valor;
    }
  }
  const coverage = naoPagoTotal > 0 ? naoPagoSimulated / naoPagoTotal : 1;
  return { simulated, tasyCeiling, naoPagoTotal, naoPagoSimulated, coverage };
}

function computeTvrAgreementTotals(list: TvrResult[]): { totalComplementarAcordo: number; totalRetirarAcordo: number } {
  return list.reduce(
    (acc, r) => {
      const ajuste = r.ajuste_acordo ?? 0;
      if (ajuste < -0.5) acc.totalComplementarAcordo += Math.abs(ajuste);
      acc.totalRetirarAcordo += getTvrValorRecuperar(r);
      return acc;
    },
    { totalComplementarAcordo: 0, totalRetirarAcordo: 0 },
  );
}

/**
 * FONTE ÚNICA de todos os headline numbers do relatório TVR.
 *
 * Consumidores: card "Total a complementar", card "Total a retirar",
 * modal "Encaminhar apuração". Se qualquer um desses precisar exibir
 * um número, DEVE vir daqui — não recalcular inline. Testes de
 * invariante em `tvrMenuCardConsistency.test.ts` bloqueiam divergência.
 */
export function computeTvrHeadlineTotals(list: TvrResult[]): {
  totalComplementar: number;
  totalRetirar: number;
  totalComplementarAcordo: number;
  totalRetirarAcordo: number;
  tetoTasy: number;
  naoPagoTotal: number;
  naoPagoSimulated: number;
  coverage: number;
} {
  const financial = computeTvrFinancialTotals(list);
  const acordo = computeTvrAgreementTotals(list);
  const bd = computeTvrComplementarBreakdown(list);
  return {
    totalComplementar: financial.totalComplementar,
    totalRetirar: financial.totalRetirar,
    totalComplementarAcordo: acordo.totalComplementarAcordo,
    totalRetirarAcordo: acordo.totalRetirarAcordo,
    tetoTasy: bd.tasyCeiling,
    naoPagoTotal: bd.naoPagoTotal,
    naoPagoSimulated: bd.naoPagoSimulated,
    coverage: bd.coverage,
  };
}
