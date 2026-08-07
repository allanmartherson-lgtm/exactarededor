import { describe, expect, it } from "vitest";
import {
  computeTvrFinancialTotals,
  describeTvrAcao,
  getTvrValorRecuperar,
  type TvrResult,
} from "@/lib/tvr";

/**
 * Factory minimalista — mesma abordagem usada em tvrReplaceSummary.test.ts.
 * Só preenche campos relevantes para os helpers puros; demais recebem defaults
 * seguros para nunca disparar branches acidentalmente.
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

describe("describeTvrAcao — regressão do bug 'Faltou pagar sem ajuste'", () => {
  it("nao_pago SEMPRE vira complementar, mesmo com ajuste_acordo=0 (bug original)", () => {
    // Cenário exato do bug: status=nao_pago, tipo_analise='valor' (default),
    // ajuste_acordo=0 → antes caía no fallback "— Sem ajuste".
    const acao = describeTvrAcao(
      r({ status: "nao_pago", valor_total_tasy: 313.19, ajuste_acordo: 0 }),
    );
    expect(acao.kind).toBe("complementar");
    expect(acao.valor).toBeCloseTo(313.19, 2);
    expect(acao.label).toContain("Complementar");
    expect(acao.label).not.toContain("Sem ajuste");
  });

  it("nao_pago com valor_total_tasy=0 ainda classifica como complementar (não engole)", () => {
    const acao = describeTvrAcao(r({ status: "nao_pago", valor_total_tasy: 0 }));
    expect(acao.kind).toBe("complementar");
    expect(acao.valor).toBe(0);
  });

  it("nao_pago com regra prevista usa valor_previsto_regra (não o bruto TASY)", () => {
    // Médico recebe 50% do convênio. TASY bruto = 1000, regra pagaria = 500.
    // Antes: complementava 1000 (errado). Agora: 500 e hint menciona regra.
    const acao = describeTvrAcao(
      r({
        status: "nao_pago",
        valor_total_tasy: 1000,
        valor_previsto_regra: 500,
        calculo_previsto: "#1 Cirurgião 50% (percentual_sobre_convenio)",
        previsto_source: "regra",
      }),
    );
    expect(acao.kind).toBe("complementar");
    expect(acao.valor).toBeCloseTo(500, 2);
    expect(acao.label).toContain("500");
    expect(acao.hint.toLowerCase()).toContain("regra prevista");
  });

  it("nao_pago SEM regra prevista mantém valor_total_tasy (retrocompatível)", () => {
    const acao = describeTvrAcao(
      r({
        status: "nao_pago",
        valor_total_tasy: 800,
        // valor_previsto_regra ausente → fallback bruto
        previsto_source: "bruto",
      }),
    );
    expect(acao.valor).toBeCloseTo(800, 2);
    expect(acao.hint.toLowerCase()).toContain("bruto");
  });

  it("nao_pago com regra prevista valor_fixo (tipo_analise_previsto='quantidade') usa valor_previsto_regra", () => {
    // Regra prevista é valor_fixo → Fix B alinhou r.tipo_analise para 'quantidade'.
    // describeTvrAcao ainda precisa complementar o valor previsto (não cair no
    // ramo tipo_analise='quantidade' que exige dif_qtd — nao_pago tem precedência).
    const acao = describeTvrAcao(
      r({
        status: "nao_pago",
        tipo_analise: "quantidade", // alinhado por Fix B
        tipo_analise_previsto: "quantidade",
        valor_previsto_regra: 300,
        valor_total_tasy: 1000,
        calculo_previsto: "#1 Consulta R$300 (valor_fixo)",
        previsto_source: "regra",
      }),
    );
    expect(acao.kind).toBe("complementar");
    expect(acao.valor).toBeCloseTo(300, 2);
    expect(acao.hint.toLowerCase()).toContain("regra prevista");
  });

  it("ausente_tasy usa valor_com_acordo quando presente (base operacional pós-regra)", () => {
    const acao = describeTvrAcao(
      r({ status: "ausente_tasy", valor_pago_base: 500, valor_com_acordo: 350 }),
    );
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(350, 2);
    expect(acao.label).toContain("Recuperar");
  });

  it("ausente_tasy cai para valor_pago_base quando valor_com_acordo ≈ 0 (rodadas antigas)", () => {
    const acao = describeTvrAcao(
      r({ status: "ausente_tasy", valor_pago_base: 420, valor_com_acordo: 0 }),
    );
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(420, 2);
  });

  it("sem_lastro_tasy pede validação manual (pacote sem faturamento individual)", () => {
    const acao = describeTvrAcao(
      r({
        status: "ausente_tasy",
        sem_lastro_tasy: true,
        valor_com_acordo: 1000,
        calculo_aplicado: "pacote",
      }),
    );
    // ausente_tasy tem precedência sobre sem_lastro_tasy — mantém "recuperar".
    // Se algum dia a ordem inverter, este teste sinaliza a regressão.
    expect(acao.kind).toBe("recuperar");
  });

  it("sem_lastro_tasy sem status ausente_tasy vira 'validar'", () => {
    const acao = describeTvrAcao(
      r({ status: "div_valor", sem_lastro_tasy: true, valor_com_acordo: 800 }),
    );
    expect(acao.kind).toBe("validar");
    expect(acao.label).toContain("Validar");
  });

  it("tipo_analise='quantidade' + dif_qtd negativo → recuperar valor pago", () => {
    const acao = describeTvrAcao(
      r({
        status: "pago_a_mais",
        tipo_analise: "quantidade",
        dif_qtd: -1,
        valor_com_acordo: 200,
        calculo_aplicado: "valor_fixo",
      }),
    );
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(200, 2);
    expect(acao.hint).toContain("valor fixo");
  });

  it("por presença ausente recupera valor pago mesmo quando valor_recuperar_acordo veio zerado", () => {
    const item = r({
      status: "ausente_tasy",
      tipo_analise: "quantidade",
      sem_lastro_tasy: true,
      valor_recuperar_acordo: 0,
      ajuste_acordo: 0,
      valor_com_acordo: 0,
      valor_pago_base: 420,
    });
    const acao = describeTvrAcao(item);
    const totals = computeTvrFinancialTotals([item]);

    expect(getTvrValorRecuperar(item)).toBeCloseTo(420, 2);
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(420, 2);
    expect(totals.totalRetirar).toBeCloseTo(420, 2);
  });

  it("por presença com quantidade divergente recupera proporcionalmente quando acordo antigo veio zerado", () => {
    const item = r({
      status: "pago_a_mais",
      tipo_analise: "quantidade",
      dif_qtd: -1,
      qtd_por_func: 2,
      qtd_tasy: 1,
      valor_recuperar_acordo: 0,
      ajuste_acordo: 0,
      valor_com_acordo: 0,
      valor_pago_base: 300,
    });
    const acao = describeTvrAcao(item);

    expect(getTvrValorRecuperar(item)).toBeCloseTo(150, 2);
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(150, 2);
  });

  it("tipo_analise='quantidade' com quantidade OK → sem ajuste", () => {
    const acao = describeTvrAcao(
      r({ status: "ok", tipo_analise: "quantidade", dif_qtd: 0 }),
    );
    expect(acao.kind).toBe("ok");
    expect(acao.label).toContain("Sem ajuste");
  });

  it("tipo_analise='valor' + ajuste_acordo positivo → recuperar", () => {
    const acao = describeTvrAcao(
      r({
        status: "div_valor",
        tipo_analise: "valor",
        ajuste_acordo: 150,
        valor_pago_base: 1000,
        valor_com_acordo: 700,
        dif_valor: -300,
      }),
    );
    expect(acao.kind).toBe("recuperar");
    expect(acao.valor).toBeCloseTo(150, 2);
  });

  it("tipo_analise='valor' + ajuste_acordo negativo → complementar", () => {
    const acao = describeTvrAcao(
      r({
        status: "div_valor",
        tipo_analise: "valor",
        ajuste_acordo: -80,
        valor_pago_base: 500,
        valor_com_acordo: 400,
        dif_valor: 100,
      }),
    );
    expect(acao.kind).toBe("complementar");
    expect(acao.valor).toBeCloseTo(80, 2);
  });

  it("fallback 'sem ajuste' só dispara em tipo_analise='valor' sem ajuste e sem status crítico", () => {
    const acao = describeTvrAcao(r({ status: "ok", tipo_analise: "valor" }));
    expect(acao.kind).toBe("ok");
    expect(acao.hint).toBe("Pago no lote bate com devido hoje");
  });
});

describe("Card × planilha — computeTvrFinancialTotals usa a base operacional certa", () => {
  it("regra %convênio (tipo_analise='valor') desconta pelo 100% convênio (dif_valor)", () => {
    const list: TvrResult[] = [
      r({ status: "div_valor", tipo_analise: "valor", dif_valor: -300, valor_pago_base: 1000 }),
      r({ status: "div_valor", tipo_analise: "valor", dif_valor: 200, valor_pago_base: 800 }),
    ];
    const { totalComplementar, totalRetirar } = computeTvrFinancialTotals(list);
    expect(totalRetirar).toBeCloseTo(300, 2); // 100% convênio da diferença
    expect(totalComplementar).toBeCloseTo(200, 2);
  });

  it("regra pacote/valor_fixo (tipo_analise='quantidade') desconta ajuste_acordo, NÃO 100% convênio", () => {
    // Bug que a mudança resolve: antes o card somava dif_valor (bruto convênio)
    // mesmo para pacote/valor fixo, inflando o "a descontar" versus a planilha.
    const list: TvrResult[] = [
      r({
        status: "pago_a_mais",
        tipo_analise: "quantidade",
        dif_qtd: -1,
        dif_valor: -5000, // convênio bruto — NÃO deve entrar
        ajuste_acordo: 800, // valor efetivamente pago pela qtd excedente
        valor_com_acordo: 800,
        valor_pago_base: 5000,
      }),
    ];
    const { totalRetirar } = computeTvrFinancialTotals(list);
    expect(totalRetirar).toBeCloseTo(800, 2);
  });

  it("ausente_tasy usa valor_com_acordo (pós-regra), fallback valor_pago_base", () => {
    const list: TvrResult[] = [
      r({ status: "ausente_tasy", valor_com_acordo: 350, valor_pago_base: 500 }),
      r({ status: "ausente_tasy", valor_com_acordo: 0, valor_pago_base: 420 }),
    ];
    const { totalRetirar } = computeTvrFinancialTotals(list);
    expect(totalRetirar).toBeCloseTo(770, 2); // 350 + 420
  });

  it("nao_pago SEM previsão NÃO soma no complementar (evita falso positivo)", () => {
    // Bruto TASY sem regra prevista é apenas TETO, não compromisso.
    // Aparece separado via computeTvrComplementarBreakdown().tasyCeiling.
    const list: TvrResult[] = [
      r({ status: "nao_pago", valor_total_tasy: 1000 }),
      r({ status: "nao_pago", valor_total_tasy: 250 }),
    ];
    const { totalComplementar, totalRetirar } = computeTvrFinancialTotals(list);
    expect(totalComplementar).toBe(0);
    expect(totalRetirar).toBe(0);
  });

  it("nao_pago só soma quando há valor_previsto_regra (simulação/histórico)", () => {
    const list: TvrResult[] = [
      // Com regra: complementa 500.
      r({ status: "nao_pago", valor_total_tasy: 1000, valor_previsto_regra: 500 }),
      // Sem regra: NÃO soma (é teto TASY, não compromisso).
      r({ status: "nao_pago", valor_total_tasy: 250 }),
    ];
    const { totalComplementar } = computeTvrFinancialTotals(list);
    expect(totalComplementar).toBeCloseTo(500, 2);
  });
  it("cenário misto reflete a lógica operacional da planilha", () => {
    const list: TvrResult[] = [
      // 1) Faltou pagar COM previsão → complementa 300 (valor previsto),
      //    não os 500 brutos TASY.
      r({ status: "nao_pago", valor_total_tasy: 500, valor_previsto_regra: 300 }),
      // 2) Pago a menos regra %convênio → complementar dif_valor
      r({ status: "div_valor", tipo_analise: "valor", dif_valor: 120, valor_pago_base: 400 }),
      // 3) Pago a mais regra pacote → recuperar ajuste_acordo (não os 3000 brutos)
      r({
        status: "pago_a_mais",
        tipo_analise: "quantidade",
        dif_qtd: -1,
        dif_valor: -3000,
        ajuste_acordo: 450,
        valor_com_acordo: 450,
      }),
      // 4) Ausente base → recuperar valor pós-acordo
      r({ status: "ausente_tasy", valor_com_acordo: 220, valor_pago_base: 900 }),
      // 5) OK — não entra
      r({ status: "ok" }),
    ];
    const { totalComplementar, totalRetirar } = computeTvrFinancialTotals(list);
    expect(totalComplementar).toBeCloseTo(420, 2); // 300 + 120
    expect(totalRetirar).toBeCloseTo(670, 2); // 450 + 220
  });
});
