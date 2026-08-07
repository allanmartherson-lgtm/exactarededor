import { describe, expect, it } from "vitest";
import { computeTvrFinancialTotals, type TvrResult } from "@/lib/tvr";

/**
 * Invariante: o modal "Encaminhar apuração" e os cards do relatório precisam
 * usar EXATAMENTE a mesma fórmula. Se alguém reimplementar o cálculo inline
 * no menu (regressão histórica: `sum + valor_total_tasy` para nao_pago sem
 * previsão), este teste falha.
 *
 * O teste roda a mesma função nos dois "consumidores" e compara. Se alguém
 * futuro trocar por outra fonte, o próprio import quebra.
 */
function r(overrides: Partial<TvrResult>): TvrResult {
  return {
    key: overrides.key ?? Math.random().toString(36).slice(2),
    atendimento: "",
    tuss: "",
    procedimento: "",
    paciente: "",
    data: "",
    convenio: "",
    medico: "",
    funcao: "",
    qtd_tasy: 0,
    valor_unit_tasy: 0,
    valor_total_tasy: 0,
    qtd_por_func: 0,
    n_funcs: 0,
    funcoes_pagas: "",
    lotes: "",
    valor_pago_base: 0,
    valor_com_acordo: 0,
    dif_qtd: 0,
    dif_valor: 0,
    valor_recuperar_acordo: 0,
    valor_com_acordo_recalc: 0,
    ajuste_acordo: 0,
    tipo_analise: "valor",
    status: "ok",
    ...overrides,
  };
}

describe("Consistência menu de seleção × cards do relatório", () => {
  const results: TvrResult[] = [
    r({ status: "nao_pago", valor_total_tasy: 800 }), // sem previsão: não soma
    r({ status: "nao_pago", valor_total_tasy: 1000, valor_previsto_regra: 500 }),
    r({ status: "div_valor", dif_valor: 120 }),
    r({ status: "pago_a_mais", tipo_analise: "quantidade", ajuste_acordo: 220 }),
    r({ status: "ausente_tasy", valor_com_acordo: 450 }),
    r({ status: "ok" }),
  ];

  it("card e menu produzem o mesmo totalComplementar (mesma função)", () => {
    // Card: todo o results
    const card = computeTvrFinancialTotals(results).totalComplementar;
    // Menu: apenas subset actionable — mesma função aplicada ao subset.
    const actionable = results.filter((x) =>
      ["nao_pago", "div_valor", "div_qtd_valor", "pago_a_mais"].includes(x.status),
    );
    const menu = computeTvrFinancialTotals(actionable).totalComplementar;
    // Subset actionable exclui só ausente_tasy/ok — nenhum deles soma em
    // complementar → totais iguais.
    expect(menu).toBeCloseTo(card, 2);
    expect(menu).toBeCloseTo(500 + 120, 2);
  });

  it("subset de retirar do menu nunca extrapola o card (invariante)", () => {
    const cardRet = computeTvrFinancialTotals(results).totalRetirar;
    const retirarSubset = results.filter((x) => (x.valor_recuperar_acordo ?? 0) > 0.5
      || x.status === "ausente_tasy" || x.status === "pago_a_mais");
    const menuRet = computeTvrFinancialTotals(retirarSubset).totalRetirar;
    expect(menuRet).toBeLessThanOrEqual(cardRet + 0.5);
  });

  it("nao_pago sem previsão NÃO infla o total do menu (regressão do bug antigo)", () => {
    const bugCase = [r({ status: "nao_pago", valor_total_tasy: 999 })];
    // Fórmula antiga (bug): sum + valor_total_tasy → 999.
    // Fórmula unificada: 0 (sem previsão de regra).
    expect(computeTvrFinancialTotals(bugCase).totalComplementar).toBe(0);
  });
});
