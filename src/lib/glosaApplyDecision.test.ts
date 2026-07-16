import { describe, it, expect } from "vitest";
import { decideGlosaApplications } from "./glosaApplyDecision";

// Invariante: glosa desconta da PJ no lote mesmo quando o médico
// da dívida não tem produção no lote vigente.
// Ver: mem://constraints/glosa-desconta-pj-nao-medico

describe("decideGlosaApplications — glosa desconta da PJ, não do médico", () => {
  it("aplica a glosa mesmo quando o médico da dívida NÃO tem produção no lote", () => {
    const debts = [
      { id: "d1", doctor_id: "medico-sem-producao", total_debt: 1200, parcelas_default: 12 },
    ];
    const doctorIdsComProducao = new Set<string>(); // vazio de propósito

    const { decisions } = decideGlosaApplications(debts, 500, doctorIdsComProducao);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      debt_id: "d1",
      action: "proposto",
      valor: 100,
      parcela_numero: 1,
    });
  });

  it("aplica igual quando o médico TEM produção — resultado idêntico ao caso sem produção", () => {
    const debts = [{ id: "d1", doctor_id: "m1", total_debt: 1200, parcelas_default: 12 }];

    const semProd = decideGlosaApplications(debts, 500, new Set());
    const comProd = decideGlosaApplications(debts, 500, new Set(["m1"]));

    expect(semProd.decisions).toEqual(comProd.decisions);
    expect(semProd.capacidadeRestante).toBe(comProd.capacidadeRestante);
  });

  it("múltiplas dívidas de médicos sem produção consomem a capacidade da PJ em FIFO", () => {
    const debts = [
      { id: "d1", doctor_id: "m1", total_debt: 1200, parcelas_default: 12, created_at: "2025-01-01" },
      { id: "d2", doctor_id: "m2", total_debt: 600,  parcelas_default: 6,  created_at: "2025-02-01" },
      { id: "d3", doctor_id: "m3", total_debt: 240,  parcelas_default: 12, created_at: "2025-03-01" },
    ];
    // capacidade suficiente pra tudo: 100 + 100 + 20 = 220
    const { decisions, capacidadeRestante } = decideGlosaApplications(debts, 220, new Set());

    expect(decisions.map((d) => d.action)).toEqual(["proposto", "proposto", "proposto"]);
    expect(capacidadeRestante).toBe(0);
  });

  it("só adia quando falta capacidade da PJ (nunca por ausência do médico)", () => {
    const debts = [
      { id: "d1", doctor_id: "sem-prod-1", total_debt: 1200, parcelas_default: 12 }, // parcela 100
      { id: "d2", doctor_id: "sem-prod-2", total_debt: 1200, parcelas_default: 12 }, // parcela 100
    ];
    const { decisions } = decideGlosaApplications(debts, 100, new Set());

    expect(decisions[0]).toMatchObject({ action: "proposto", valor: 100 });
    expect(decisions[1]).toMatchObject({ action: "postponed", reason: "insufficient_net" });
  });

  it("adia integralmente quando parcela prevista > capacidade restante (sem parcial)", () => {
    const debts = [{ id: "d1", doctor_id: "sem-prod", total_debt: 1200, parcelas_default: 12 }];
    const { decisions, capacidadeRestante } = decideGlosaApplications(debts, 40, new Set());

    expect(decisions[0]).toMatchObject({
      action: "postponed",
      reason: "insufficient_net",
      parcela_prevista: 100,
    });
    // capacidade preservada — nada foi consumido, rola pro próximo ciclo
    expect(capacidadeRestante).toBe(40);
  });

  it("REGRESSÃO: NUNCA gera 'postponed' com motivo relacionado a produção do médico", () => {
    const debts = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      doctor_id: `medico-fantasma-${i}`,
      total_debt: 120,
      parcelas_default: 12,
    }));
    const { decisions } = decideGlosaApplications(debts, 999_999, new Set());

    for (const d of decisions) {
      if (d.action === "postponed") {
        expect(d.reason).toBe("insufficient_net");
        expect((d as any).reason).not.toBe("sem_producao");
      }
    }
    // Com capacidade sobrando, todas devem ser propostas
    expect(decisions.every((d) => d.action === "proposto")).toBe(true);
  });

  it("não regride comportamento quando doctor_id da dívida é null (dívida institucional)", () => {
    const debts = [{ id: "d1", doctor_id: null, total_debt: 600, parcelas_default: 6 }];
    const { decisions } = decideGlosaApplications(debts, 500, new Set());
    expect(decisions[0]).toMatchObject({ action: "proposto", valor: 100 });
  });
});
