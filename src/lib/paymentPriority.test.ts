import { describe, it, expect } from "vitest";
import { calcPriorityScore, type PriorityInput } from "./paymentPriority";

const base: PriorityInput = {
  slaLevel: null,
  elapsedDays: 0,
  riskScore: 0,
  status: "em_analise_ia",
  totalAmount: 0,
  itemsCount: 0,
};

describe("calcPriorityScore · pesos individuais", () => {
  it("SLA vencido soma 50", () => {
    const r = calcPriorityScore({ ...base, slaLevel: "vencido" });
    expect(r.score).toBe(50);
    expect(r.reasons).toContain("SLA vencido");
  });
  it("SLA preventivo soma 25", () => {
    const r = calcPriorityScore({ ...base, slaLevel: "preventivo" });
    expect(r.score).toBe(25);
  });
  it("SLA ok/null soma 0", () => {
    expect(calcPriorityScore({ ...base, slaLevel: "ok" }).score).toBe(0);
    expect(calcPriorityScore({ ...base, slaLevel: null }).score).toBe(0);
  });
  it("risco > 70 soma 30", () => {
    expect(calcPriorityScore({ ...base, riskScore: 71 }).score).toBe(30);
  });
  it("risco exatamente 70 fica na faixa média (soma 15, não 30)", () => {
    expect(calcPriorityScore({ ...base, riskScore: 70 }).score).toBe(15);
  });
  it("risco exatamente 40 entra na faixa média (soma 15)", () => {
    expect(calcPriorityScore({ ...base, riskScore: 40 }).score).toBe(15);
  });
  it("risco 39 não soma nada", () => {
    expect(calcPriorityScore({ ...base, riskScore: 39 }).score).toBe(0);
  });
  it("parado > 7 dias soma 15", () => {
    expect(calcPriorityScore({ ...base, elapsedDays: 8 }).score).toBe(15);
  });
  it("parado > 3 e <= 7 soma 8", () => {
    expect(calcPriorityScore({ ...base, elapsedDays: 4 }).score).toBe(8);
  });
  it("parado exatamente 7 fica na faixa de 8 (não 15)", () => {
    expect(calcPriorityScore({ ...base, elapsedDays: 7 }).score).toBe(8);
  });
  it("alto valor (> 500000) soma 5", () => {
    expect(calcPriorityScore({ ...base, totalAmount: 500001 }).score).toBe(5);
  });
  it("valor exatamente 500000 não soma", () => {
    expect(calcPriorityScore({ ...base, totalAmount: 500000 }).score).toBe(0);
  });
});

describe("calcPriorityScore · soma e teto", () => {
  it("soma combinada bate (vencido 50 + risco médio 15 + parado>3 8 = 73)", () => {
    const r = calcPriorityScore({ ...base, slaLevel: "vencido", riskScore: 40, elapsedDays: 4 });
    expect(r.score).toBe(73);
  });
  it("cenário máximo é limitado a 100", () => {
    const r = calcPriorityScore({ ...base, slaLevel: "vencido", riskScore: 90, elapsedDays: 10, totalAmount: 999999 });
    expect(r.score).toBe(100);
  });
});

describe("calcPriorityScore · faixas de nível", () => {
  it("score >= 75 é urgente", () => {
    expect(calcPriorityScore({ ...base, slaLevel: "vencido", riskScore: 80 }).level).toBe("urgente");
  });
  it("score 50 a 74 é alta", () => {
    expect(calcPriorityScore({ ...base, slaLevel: "vencido" }).level).toBe("alta");
  });
  it("score 25 a 49 é normal", () => {
    expect(calcPriorityScore({ ...base, slaLevel: "preventivo" }).level).toBe("normal");
  });
  it("score < 25 é baixa", () => {
    expect(calcPriorityScore({ ...base, riskScore: 50 }).level).toBe("baixa");
  });
  it("cenário totalmente zerado é baixa", () => {
    expect(calcPriorityScore(base).level).toBe("baixa");
  });
});
