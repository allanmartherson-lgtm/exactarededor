import { describe, expect, it } from "vitest";
import { classifyRoleForPreview, computeTvrRulePreview } from "../tvrRulePreview";

describe("classifyRoleForPreview", () => {
  it.each([
    ["Cirurgião", "principal"],
    ["Cirurgiao Principal", "principal"],
    ["Anestesista", "principal"],
    ["Primeiro Auxiliar", "primeiro_aux"],
    ["1º Auxiliar", "primeiro_aux"],
    ["Segundo Auxiliar", "segundo_aux"],
    ["2º Auxiliar", "segundo_aux"],
    ["Auxiliar", "auxiliar_generico"],
    ["Instrumentador", "instrumentador"],
    ["", "principal"],
    [null, "principal"],
  ] as const)("classifica %s → %s", (funcao, expected) => {
    expect(classifyRoleForPreview(funcao)).toBe(expected);
  });
});

describe("computeTvrRulePreview — percentual_sobre_convenio", () => {
  it("principal: aplica convenio_percentage sobre valor_total_tasy", () => {
    const out = computeTvrRulePreview({
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: 50,
      valor_total_tasy: 1000,
      qtd_tasy: 1,
      funcao: "Cirurgião",
    });
    expect(out.source).toBe("regra");
    expect(out.tipo_analise).toBe("valor");
    expect(out.valor).toBeCloseTo(500, 2);
  });

  it("primeiro auxiliar: usa aux_first_pct quando presente", () => {
    const out = computeTvrRulePreview({
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: 50,
      aux_first_pct: 30,
      valor_total_tasy: 1000,
      qtd_tasy: 1,
      funcao: "1º Auxiliar",
    });
    expect(out.valor).toBeCloseTo(300, 2);
  });

  it("primeiro auxiliar: cai para auxiliary_pct genérico se aux_first_pct ausente", () => {
    const out = computeTvrRulePreview({
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: 50,
      auxiliary_pct: 20,
      valor_total_tasy: 1000,
      qtd_tasy: 1,
      funcao: "Primeiro Auxiliar",
    });
    expect(out.valor).toBeCloseTo(200, 2);
  });

  it("sem percentual do papel → source=bruto, valor=null (não chuta)", () => {
    const out = computeTvrRulePreview({
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: null,
      valor_total_tasy: 1000,
      qtd_tasy: 1,
      funcao: "Cirurgião",
    });
    expect(out.valor).toBeNull();
    expect(out.source).toBe("bruto");
  });

  it("aceita alias 'percentual_convenio'", () => {
    const out = computeTvrRulePreview({
      calculation_type: "percentual_convenio",
      convenio_percentage: 100,
      valor_total_tasy: 400,
      qtd_tasy: 1,
    });
    expect(out.valor).toBeCloseTo(400, 2);
  });
});

describe("computeTvrRulePreview — valor_fixo", () => {
  it("multiplica fixed_amount pela qtd_tasy", () => {
    const out = computeTvrRulePreview({
      calculation_type: "valor_fixo",
      fixed_amount: 250,
      valor_total_tasy: 9999, // ignorado
      qtd_tasy: 3,
    });
    expect(out.source).toBe("regra");
    expect(out.tipo_analise).toBe("quantidade");
    expect(out.valor).toBeCloseTo(750, 2);
  });

  it("qtd_tasy ausente/0 assume 1", () => {
    const out = computeTvrRulePreview({
      calculation_type: "valor_fixo",
      fixed_amount: 250,
      valor_total_tasy: 0,
      qtd_tasy: 0,
    });
    expect(out.valor).toBeCloseTo(250, 2);
  });

  it("sem fixed_amount → source=bruto", () => {
    const out = computeTvrRulePreview({
      calculation_type: "valor_fixo",
      fixed_amount: null,
      valor_total_tasy: 100,
      qtd_tasy: 1,
    });
    expect(out.valor).toBeNull();
    expect(out.source).toBe("bruto");
  });
});

describe("computeTvrRulePreview — outros tipos", () => {
  it("exclusao → 0 com source=regra", () => {
    const out = computeTvrRulePreview({
      calculation_type: "exclusao",
      valor_total_tasy: 500,
      qtd_tasy: 1,
    });
    expect(out.valor).toBe(0);
    expect(out.source).toBe("regra");
  });

  it("pacote → não estima (fase 2) — source=bruto", () => {
    const out = computeTvrRulePreview({
      calculation_type: "pacote",
      valor_total_tasy: 500,
      qtd_tasy: 1,
    });
    expect(out.valor).toBeNull();
    expect(out.source).toBe("bruto");
  });

  it("tabela_diferenciada → não estima (fase 2) — source=bruto", () => {
    const out = computeTvrRulePreview({
      calculation_type: "tabela_diferenciada",
      valor_total_tasy: 500,
      qtd_tasy: 1,
    });
    expect(out.valor).toBeNull();
    expect(out.source).toBe("bruto");
  });

  it("calculation_type vazio → source=bruto", () => {
    const out = computeTvrRulePreview({
      calculation_type: null,
      valor_total_tasy: 500,
      qtd_tasy: 1,
    });
    expect(out.valor).toBeNull();
    expect(out.source).toBe("bruto");
  });
});
