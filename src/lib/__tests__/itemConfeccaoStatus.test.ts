import { describe, it, expect } from "vitest";
import { deriveConfeccaoStatus } from "../itemConfeccaoStatus";

describe("deriveConfeccaoStatus", () => {
  it("retorna sem_regra quando não há applied_rule_id", () => {
    expect(deriveConfeccaoStatus({ applied_rule_id: null, expected_amount: 0 })).toBe("sem_regra");
  });

  it("retorna sem_regra quando sem_regra=true mesmo com regra aplicada", () => {
    expect(
      deriveConfeccaoStatus({ applied_rule_id: "r1", sem_regra: true, expected_amount: 100 }),
    ).toBe("sem_regra");
  });

  it("retorna sem_regra quando matched_priority='sem_regra'", () => {
    expect(
      deriveConfeccaoStatus({
        applied_rule_id: null,
        ai_findings: { matched_priority: "sem_regra" },
      }),
    ).toBe("sem_regra");
  });

  it("retorna divergente quando matched_priority='conflito'", () => {
    expect(
      deriveConfeccaoStatus({
        applied_rule_id: "r1",
        expected_amount: 100,
        ai_findings: { matched_priority: "conflito" },
      }),
    ).toBe("divergente");
  });

  it("retorna divergente em erro_duplicidade_calculo", () => {
    expect(
      deriveConfeccaoStatus({
        applied_rule_id: "r1",
        expected_amount: 50,
        ai_status: "erro_duplicidade_calculo",
      }),
    ).toBe("divergente");
  });

  it("retorna divergente quando expected_amount é null sem calc_method", () => {
    expect(
      deriveConfeccaoStatus({ applied_rule_id: "r1", expected_amount: null, procedure_amount: 200 }),
    ).toBe("divergente");
  });

  it("retorna com_regra quando expected_amount é zero (pacote absorvido)", () => {
    expect(
      deriveConfeccaoStatus({ applied_rule_id: "r1", applied_calc_method: "pacote", expected_amount: 0 }),
    ).toBe("com_regra");
  });

  it("retorna com_regra no caminho feliz", () => {
    expect(
      deriveConfeccaoStatus({
        applied_rule_id: "r1",
        applied_calc_method: "percentual_convenio",
        expected_amount: 99.11,
        procedure_amount: 99.11,
      }),
    ).toBe("com_regra");
  });
});
