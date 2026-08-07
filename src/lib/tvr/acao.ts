/**
 * Tradução de uma linha TVR para a ação que o analista deve tomar.
 *
 * Consumido pela coluna "Ação sugerida" da UI e pelo export Excel — os dois
 * devem sempre concordar. Testado em describeTvrAcao.test.ts.
 */
import type { TvrAcao, TvrResult } from "./types";
import { brl } from "./format";
import { getTvrValorRecuperar } from "./totals";

/**
 * Ordem de decisão (não regredir):
 *   1. status "nao_pago" (Faltou pagar): SEMPRE complementar valor_total_tasy.
 *      Não pode cair no fallback "sem ajuste" só porque ajuste_acordo=0.
 *   2. status "ausente_tasy": SEMPRE recuperar (valor_com_acordo ?? valor_pago_base).
 *   3. sem_lastro_tasy (pacote/valor fixo sem lastro): "Validar manualmente".
 *   4. tipo_analise === "quantidade": decide por dif_qtd (TASY não é base de R$).
 *   5. tipo_analise === "valor": decide por ajuste_acordo (fallback fica só aqui).
 */
export function describeTvrAcao(r: TvrResult): TvrAcao {
  const method = (r.calculo_aplicado ?? "").toLowerCase();
  const prettyMethod =
    method.includes("pacote") ? "pacote"
    : method.includes("valor_fixo") ? "valor fixo"
    : method.includes("tabela_diferenciada") ? "tabela diferenciada"
    : method.includes("bonus") ? "bônus"
    : method.includes("percentual") ? "% do convênio"
    : "acordo do lote";
  if (r.status === "nao_pago") {
    // Preferimos o valor que a regra prevista pagaria hoje (mesma lógica do
    // motor no lote original). Se não conseguimos estimar (pacote/tabela ou
    // dado faltante), caímos para valor_total_tasy — bruto 100% convênio.
    const usouRegra = typeof r.valor_previsto_regra === "number";
    const valor = usouRegra ? r.valor_previsto_regra! : (r.valor_total_tasy || 0);
    const hint = usouRegra
      ? `Regra prevista aplicada${r.calculo_previsto ? `: ${r.calculo_previsto}` : ""} — mesmo cálculo do lote anterior.`
      : `Item no TASY (${prettyMethod}) sem pagamento no lote — sem regra prevista, exibindo valor bruto 100% convênio. Revisar antes de complementar.`;
    return {
      kind: "complementar",
      valor,
      label: `↑ Complementar ${brl(valor)}`,
      hint,
    };
  }
  if (r.status === "ausente_tasy") {
    const valor = r.valor_com_acordo && r.valor_com_acordo > 0.5 ? r.valor_com_acordo : r.valor_pago_base;
    const compRef = r.lotes ? r.lotes : "competência anterior";
    return {
      kind: "recuperar",
      valor,
      label: `↓ Recuperar ${brl(valor)}`,
      hint: `Procedimento (${r.tuss || "—"} - ${r.procedimento || "—"}) pago em ${compRef} mas removido pela auditoria hospitalar. Valor de ${brl(valor)} a descontar.`,
    };
  }
  if (r.sem_lastro_tasy) {
    return {
      kind: "validar",
      valor: r.valor_com_acordo || 0,
      label: "— Validar manualmente",
      hint: `Pago no lote (${prettyMethod}) mas ausente no TASY hoje. Pacote/valor fixo pode não faturar item individual — analista decide.`,
    };
  }
  if (r.tipo_analise === "quantidade") {
    if (r.dif_qtd < -0.5) {
      const diffValor = getTvrValorRecuperar(r);
      return {
        kind: "recuperar",
        valor: diffValor,
        label: `↓ Recuperar ${brl(diffValor)}`,
        hint: `Auditoria reduziu de ${r.qtd_por_func.toFixed(0)} para ${r.qtd_tasy.toFixed(0)} unidade(s) do procedimento ${r.tuss || "—"}. Diferença de ${brl(diffValor)} a descontar · ${prettyMethod}.`,
      };
    }
    if (r.dif_qtd > 0.5) {
      return {
        kind: "complementar",
        valor: 0,
        label: `↑ Complementar (+${r.dif_qtd.toFixed(2)} un)`,
        hint: `TASY hoje tem ${r.dif_qtd.toFixed(2)} un a mais · ${prettyMethod}. Valor depende da tabela do acordo.`,
      };
    }
    return { kind: "ok", valor: 0, label: "— Sem ajuste", hint: `Quantidade bate · ${prettyMethod}` };
  }
  if (r.ajuste_acordo > 0.5) {
    const compRef = r.lotes ? r.lotes : "competência anterior";
    return {
      kind: "recuperar",
      valor: r.ajuste_acordo,
      label: `↓ Recuperar ${brl(r.ajuste_acordo)}`,
      hint: `Auditoria hospitalar ajustou valor de ${brl(r.valor_pago_base)} para ${brl(r.valor_com_acordo_recalc)}. Diferença de ${brl(r.ajuste_acordo)} a descontar (ref. ${compRef}).`,
    };
  }
  if (r.ajuste_acordo < -0.5) {
    const fator = r.valor_pago_base > 0 ? (r.valor_com_acordo / r.valor_pago_base) * 100 : 0;
    const dif = Math.abs(r.dif_valor);
    const direcao = r.dif_valor > 0 ? "subiu" : "reduziu";
    return {
      kind: "complementar",
      valor: Math.abs(r.ajuste_acordo),
      label: `↑ Complementar ${brl(Math.abs(r.ajuste_acordo))}`,
      hint: `TASY ${direcao} ${brl(dif)} · acordo ${fator.toFixed(0)}% convênio`,
    };
  }
  return { kind: "ok", valor: 0, label: "— Sem ajuste", hint: "Pago no lote bate com devido hoje" };
}
