import { describe, expect, it } from "vitest";
import { computeTvrResults, normCompanyName, normConvenio } from "@/lib/tvr/engine";
import type { PagRow, TasyRow } from "@/lib/tvr";

/**
 * Testes do motor de cruzamento TASY × Repasse.
 *
 * Este código rodava dentro do closure `process` de TasyVsRepasseView e não
 * era alcançável por teste nenhum. É o ponto onde erro vira dinheiro errado:
 * decide o que a operação vai complementar ou retirar do médico.
 *
 * Convenção dos fixtures: quando NÃO queremos filtro de PJ, os `pagRows` vão
 * sem `pag_company_id`. Com company_id preenchido e sem `recon`, o motor deriva
 * o escopo a partir do próprio Repasse e passa a exigir PJ nas linhas TASY.
 */

function tasy(over: Partial<TasyRow> = {}): TasyRow {
  return {
    tasy_atendimento: "A1",
    tasy_tuss: "10101012",
    tasy_qtd: "1",
    tasy_valor_unit: "1000",
    tasy_data: "2026-03-10",
    tasy_medico: "Dr. João Silva",
    tasy_paciente: "Paciente X",
    tasy_convenio: "Unimed",
    tasy_procedimento: "Proc X",
    ...over,
  };
}

function pag(over: Partial<PagRow> = {}): PagRow {
  return {
    pag_atendimento: "A1",
    pag_tuss: "10101012",
    pag_qtd: "1",
    pag_valor_base: "1000",
    pag_valor_com_acordo: "1000",
    pag_data: "2026-03-10",
    pag_medico: "João Silva",
    pag_convenio: "Unimed",
    ...over,
  };
}

const noScope = { recon: null } as const;

describe("computeTvrResults — status por presença", () => {
  it("TASY sem contrapartida no Repasse => nao_pago", () => {
    const { results } = computeTvrResults({ tasyRows: [tasy()], pagRows: [], ...noScope });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("nao_pago");
    expect(results[0].valor_total_tasy).toBe(1000);
    expect(results[0].valor_pago_base).toBe(0);
    // nao_pago nunca gera ajuste de acordo — vira complemento na confecção.
    expect(results[0].ajuste_acordo).toBe(0);
  });

  it("Repasse sem lastro no TASY => ausente_tasy e recupera o pago", () => {
    const { results } = computeTvrResults({ tasyRows: [], pagRows: [pag()], ...noScope });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ausente_tasy");
    expect(results[0].ajuste_acordo).toBe(1000);
    expect(results[0].valor_recuperar_acordo).toBe(1000);
  });

  it("dois lados batendo => ok, sem ajuste", () => {
    const { results } = computeTvrResults({ tasyRows: [tasy()], pagRows: [pag()], ...noScope });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].ajuste_acordo).toBe(0);
  });
});

describe("computeTvrResults — análise por valor", () => {
  it("TASY maior que o pago => div_valor (pagou a menos)", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_valor_unit: "1500" })],
      pagRows: [pag({ pag_valor_base: "1000", pag_valor_com_acordo: "1000" })],
      ...noScope,
    });
    expect(results[0].status).toBe("div_valor");
    expect(results[0].dif_valor).toBe(500);
    // acordo praticado = 100% → recalc sobre TASY = 1500; pagou 1000 => -500
    expect(results[0].ajuste_acordo).toBeCloseTo(-500, 6);
  });

  it("TASY menor que o pago => pago_a_mais", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_valor_unit: "600" })],
      pagRows: [pag({ pag_valor_base: "1000", pag_valor_com_acordo: "1000" })],
      ...noScope,
    });
    expect(results[0].status).toBe("pago_a_mais");
    expect(results[0].ajuste_acordo).toBeCloseTo(400, 6);
    expect(results[0].valor_recuperar_acordo).toBeCloseTo(400, 6);
  });

  it("preserva o fator de acordo ao recalcular sobre a base TASY", () => {
    // Pagou 880 sobre base 1000 => acordo de 88%. TASY hoje diz 2000.
    // Regra pagaria 2000 * 0.88 = 1760 => faltam 880.
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_valor_unit: "2000" })],
      pagRows: [pag({ pag_valor_base: "1000", pag_valor_com_acordo: "880" })],
      ...noScope,
    });
    expect(results[0].valor_com_acordo_recalc).toBeCloseTo(1760, 6);
    expect(results[0].ajuste_acordo).toBeCloseTo(-880, 6);
  });
});

describe("computeTvrResults — análise por quantidade", () => {
  const fixed = { pag_applied_calc_method: "valor_fixo" };

  it("valor_fixo/pacote/tabela_diferenciada marcam tipo_analise=quantidade", () => {
    for (const method of ["valor_fixo", "tabela_diferenciada", "pacote_cirurgico"]) {
      const { results } = computeTvrResults({
        tasyRows: [tasy()],
        pagRows: [pag({ pag_applied_calc_method: method })],
        ...noScope,
      });
      expect(results[0].tipo_analise).toBe("quantidade");
    }
  });

  it("percentual continua sendo análise por valor", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy()],
      pagRows: [pag({ pag_applied_calc_method: "percentual" })],
      ...noScope,
    });
    expect(results[0].tipo_analise).toBe("valor");
  });

  it("em quantidade, divergência só de R$ NÃO vira status (TASY não é base)", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_valor_unit: "9999" })],
      pagRows: [pag({ ...fixed, pag_valor_base: "1000", pag_valor_com_acordo: "1000" })],
      ...noScope,
    });
    expect(results[0].tipo_analise).toBe("quantidade");
    expect(results[0].status).toBe("ok");
    expect(results[0].ajuste_acordo).toBe(0);
  });

  it("quantidade paga acima da comprovada => recupera proporcional ao déficit", () => {
    // Pagou 4 un por 1000; TASY comprova 1 => déficit 3/4 => recupera 750.
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_qtd: "1" })],
      pagRows: [pag({ ...fixed, pag_qtd: "4", pag_valor_base: "1000", pag_valor_com_acordo: "1000" })],
      ...noScope,
    });
    expect(results[0].status).toBe("pago_a_mais");
    expect(results[0].ajuste_acordo).toBeCloseTo(750, 6);
  });

  it("ausente_tasy em quantidade marca sem_lastro_tasy e retira o pago pós-regra", () => {
    const { results } = computeTvrResults({
      tasyRows: [],
      pagRows: [pag({ ...fixed, pag_valor_base: "1000", pag_valor_com_acordo: "880" })],
      ...noScope,
    });
    expect(results[0].status).toBe("ausente_tasy");
    expect(results[0].sem_lastro_tasy).toBe(true);
    expect(results[0].ajuste_acordo).toBeCloseTo(880, 6);
  });
});

describe("computeTvrResults — chave canônica de cruzamento", () => {
  it("casa TASY (só nome) com Repasse (doctor_id) via índice nome→id", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_medico: "DR. JOÃO SILVA" })],
      pagRows: [pag({ pag_doctor_id: "doc-1", pag_medico: "joao silva" })],
      ...noScope,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].key_audit?.doctor.source).toBe("repasse_id");
  });

  it("médicos diferentes no mesmo atendimento/TUSS não se misturam", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_medico: "Dr. Ana Souza" })],
      pagRows: [pag({ pag_doctor_id: "doc-1", pag_medico: "João Silva" })],
      ...noScope,
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status).sort()).toEqual(["ausente_tasy", "nao_pago"]);
  });

  it("data diferente separa as linhas", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_data: "2026-03-10" })],
      pagRows: [pag({ pag_data: "2026-03-11" })],
      ...noScope,
    });
    expect(results).toHaveLength(2);
  });

  it("agrega múltiplas funções do mesmo procedimento em uma linha", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_qtd: "2", tasy_valor_unit: "2000" })],
      pagRows: [
        pag({ pag_funcao: "Cirurgião Principal", pag_doctor_id: "d1", pag_valor_base: "1000", pag_valor_com_acordo: "1000" }),
        pag({ pag_funcao: "Auxiliar", pag_doctor_id: "d1", pag_valor_base: "1000", pag_valor_com_acordo: "1000" }),
      ],
      ...noScope,
    });
    expect(results).toHaveLength(1);
    expect(results[0].n_funcs).toBe(2);
    expect(results[0].valor_pago_base).toBe(2000);
    // 2 un no total / 2 funções = 1 un por função; TASY tem 2 => dif_qtd = 1
    expect(results[0].qtd_por_func).toBe(1);
    expect(results[0].funcoes_pagas).toContain("Cirurgião Principal");
  });

  it("prefere o doctor_id do cirurgião principal como matched_doctor_id", () => {
    const { results } = computeTvrResults({
      tasyRows: [],
      pagRows: [
        pag({ pag_funcao: "Auxiliar", pag_doctor_id: "d-aux" }),
        pag({ pag_funcao: "Cirurgião Principal", pag_doctor_id: "d-aux" }),
      ],
      ...noScope,
    });
    expect(results[0].matched_doctor_id).toBe("d-aux");
  });
});

describe("computeTvrResults — exclusões e escopo", () => {
  it("excludeTuss remove o TUSS dos DOIS lados", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_tuss: "10101012" }), tasy({ tasy_atendimento: "A2", tasy_tuss: "20202023" })],
      pagRows: [],
      excludeTuss: "10101012",
      ...noScope,
    });
    expect(results).toHaveLength(1);
    expect(results[0].tuss).toBe("20202023");
  });

  it("excludedConvenios ignora acento/caixa e conta o que removeu", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_convenio: "UNIMÉD" })],
      pagRows: [pag({ pag_convenio: "unimed" })],
      excludedConvenios: ["Unimed"],
      ...noScope,
    });
    expect(results).toHaveLength(0);
    expect(diagnostics.convTasyRemoved).toBe(1);
    expect(diagnostics.convPagRemoved).toBe(1);
  });

  it("linha TASY fora do período da apuração é descartada", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_data: "2026-01-05" })],
      pagRows: [],
      recon: { period_start: "2026-03-01", period_end: "2026-03-31" },
    });
    expect(results).toHaveLength(0);
    expect(diagnostics.tasyOutOfPeriodRemoved).toBe(1);
  });

  it("linha TASY sem data reconhecível é descartada e contada", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_data: "sem data" })],
      pagRows: [],
      ...noScope,
    });
    expect(results).toHaveLength(0);
    expect(diagnostics.tasyMissingDateRemoved).toBe(1);
  });

  it("com escopo de PJ, linha TASY sem empresa não vira nao_pago", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_empresa: "" })],
      pagRows: [],
      recon: { period_start: "2026-03-01", period_end: "2026-03-31", company_id: "pj-1" },
    });
    expect(results).toHaveLength(0);
    expect(diagnostics.tasyMissingCompany).toBe(1);
    expect(diagnostics.unresolvedPjSamples[0]).toMatchObject({ raw: "(vazio)", missing: true });
  });

  it("resolve PJ do TASY por CNPJ e mantém a linha quando está no escopo", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_empresa: "12.345.678/0001-90" })],
      pagRows: [],
      recon: { period_start: "2026-03-01", period_end: "2026-03-31", company_id: "pj-1" },
      companyIndex: { byDoc: new Map([["12345678000190", "pj-1"]]), byName: new Map() },
    });
    expect(results).toHaveLength(1);
    expect(results[0].tasy_resolved_company_id).toBe("pj-1");
    expect(diagnostics.companyTasyRemoved).toBe(0);
  });

  it("PJ resolvida fora do escopo é removida", () => {
    const { results, diagnostics } = computeTvrResults({
      tasyRows: [tasy({ tasy_empresa: "Clinica Fora Ltda" })],
      pagRows: [],
      recon: { period_start: "2026-03-01", period_end: "2026-03-31", company_id: "pj-1" },
      companyIndex: { byDoc: new Map(), byName: new Map([["clinicaforaltda", "pj-outra"]]) },
    });
    expect(results).toHaveLength(0);
    expect(diagnostics.companyTasyRemoved).toBe(1);
  });

  it("vínculo manual do wizard tem prioridade sobre o texto da empresa", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_empresa: "Nome Que Nao Resolve", tasy_resolved_company_id: "pj-1" })],
      pagRows: [],
      recon: { period_start: "2026-03-01", period_end: "2026-03-31", company_id: "pj-1" },
    });
    expect(results).toHaveLength(1);
    expect(results[0].tasy_resolved_company_id).toBe("pj-1");
  });

  it("escopo multi_pj considera todas as PJs listadas", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_empresa: "A", tasy_resolved_company_id: "pj-2" })],
      pagRows: [],
      recon: {
        period_start: "2026-03-01",
        period_end: "2026-03-31",
        company_id: "pj-1",
        scope: "multi_pj",
        multi_company_ids: ["pj-1", "pj-2"],
      },
    });
    expect(results).toHaveLength(1);
  });
});

describe("computeTvrResults — ordenação e saídas auxiliares", () => {
  it("ordena por severidade do status (nao_pago primeiro, ok por último)", () => {
    const { results } = computeTvrResults({
      tasyRows: [tasy({ tasy_atendimento: "A9" }), tasy({ tasy_atendimento: "A1" })],
      pagRows: [pag({ pag_atendimento: "A1" })],
      ...noScope,
    });
    expect(results.map((r) => r.status)).toEqual(["nao_pago", "ok"]);
  });

  it("expõe appliedCalcIdByKey para o enriquecimento pós-motor", () => {
    const { results, appliedCalcIdByKey } = computeTvrResults({
      tasyRows: [],
      pagRows: [pag({ pag_applied_calc_id: "calc-7" })],
      ...noScope,
    });
    expect(appliedCalcIdByKey.get(results[0].key)).toBe("calc-7");
  });

  it("não muta os arrays de entrada", () => {
    const tasyRows = [tasy()];
    const pagRows = [pag()];
    const snapshot = JSON.stringify({ tasyRows, pagRows });
    computeTvrResults({ tasyRows, pagRows, ...noScope });
    expect(JSON.stringify({ tasyRows, pagRows })).toBe(snapshot);
  });
});

describe("normalizadores do motor", () => {
  it("normConvenio remove acento, caixa e pontuação", () => {
    expect(normConvenio("Unimed - Regional")).toBe("unimedregional");
    expect(normConvenio("UNIMÉD")).toBe(normConvenio("unimed"));
    expect(normConvenio(null)).toBe("");
  });

  it("normCompanyName casa razão social com variações de grafia", () => {
    expect(normCompanyName("Clínica São José S/A")).toBe("clinicasaojosesa");
    expect(normCompanyName(undefined)).toBe("");
  });
});
