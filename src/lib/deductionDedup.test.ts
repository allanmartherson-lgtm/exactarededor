import { describe, it, expect } from "vitest";
import {
  computePairsToInvoke,
  debtAppliedAt,
  type DebtLite,
  type GlosaAppLite,
} from "./deductionDedup";

const debt = (id: string, company_id: string): DebtLite => ({ id, company_id });
const app = (payment_id: string, status = "proposto"): GlosaAppLite => ({
  payment_id,
  status,
});

describe("deductionDedup — idempotência de apply-company-deductions", () => {
  it("não invoca a edge quando TODOS os débitos da PJ já estão aplicados no lote-alvo", () => {
    const debts = [debt("d1", "pj1"), debt("d2", "pj1")];
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", debts]]),
      currentByPj: new Map([["pj1", "pay1"]]),
      glosaAppsByDebt: { d1: [app("pay1")], d2: [app("pay1", "confirmado")] },
    });
    expect(res.pairsToInvoke.size).toBe(0);
    expect(res.alreadyApplied).toBe(2);
  });

  it("invoca a edge quando pelo menos UM débito ainda está pendente", () => {
    const debts = [debt("d1", "pj1"), debt("d2", "pj1")];
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", debts]]),
      currentByPj: new Map([["pj1", "pay1"]]),
      glosaAppsByDebt: { d1: [app("pay1")] }, // d2 pendente
    });
    expect(res.pairsToInvoke.size).toBe(1);
    expect(res.pairsToInvoke.get("pay1|pj1")).toEqual({
      payment_id: "pay1",
      company_id: "pj1",
    });
    expect(res.alreadyApplied).toBe(1);
  });

  it("nunca gera o mesmo par (payment_id, company_id) duas vezes, mesmo com N débitos", () => {
    const debts = Array.from({ length: 50 }, (_, i) => debt(`d${i}`, "pj1"));
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", debts]]),
      currentByPj: new Map([["pj1", "pay1"]]),
      glosaAppsByDebt: {},
    });
    expect(res.pairsToInvoke.size).toBe(1); // 50 débitos → 1 invocação
  });

  it("aplicações em status revertido/postponed NÃO contam como aplicadas — deve reinvocar", () => {
    const debts = [debt("d1", "pj1")];
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", debts]]),
      currentByPj: new Map([["pj1", "pay1"]]),
      glosaAppsByDebt: {
        d1: [app("pay1", "revertido"), app("pay1", "postponed")],
      },
    });
    expect(res.pairsToInvoke.size).toBe(1);
    expect(res.alreadyApplied).toBe(0);
  });

  it("aplicação em OUTRO lote não bloqueia invocação no lote atual", () => {
    const debts = [debt("d1", "pj1")];
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", debts]]),
      currentByPj: new Map([["pj1", "pay1"]]),
      glosaAppsByDebt: { d1: [app("payOTHER", "confirmado")] },
    });
    expect(res.pairsToInvoke.size).toBe(1);
  });

  it("PJ sem lote-alvo aberto é contabilizada em missingLote e NÃO invoca", () => {
    const res = computePairsToInvoke({
      debtsByPj: new Map([["pj1", [debt("d1", "pj1")]]]),
      currentByPj: new Map(),
      glosaAppsByDebt: {},
    });
    expect(res.pairsToInvoke.size).toBe(0);
    expect(res.missingLote).toBe(1);
  });

  it("múltiplas PJs — só invoca pares realmente pendentes", () => {
    const res = computePairsToInvoke({
      debtsByPj: new Map([
        ["pj1", [debt("d1", "pj1")]],                       // pendente
        ["pj2", [debt("d2", "pj2"), debt("d3", "pj2")]],    // todos aplicados
        ["pj3", [debt("d4", "pj3")]],                       // pendente
      ]),
      currentByPj: new Map([
        ["pj1", "pay1"],
        ["pj2", "pay2"],
        ["pj3", "pay3"],
      ]),
      glosaAppsByDebt: {
        d2: [app("pay2", "confirmado")],
        d3: [app("pay2", "proposto")],
      },
    });
    expect(res.pairsToInvoke.size).toBe(2);
    expect(res.pairsToInvoke.has("pay1|pj1")).toBe(true);
    expect(res.pairsToInvoke.has("pay3|pj3")).toBe(true);
    expect(res.pairsToInvoke.has("pay2|pj2")).toBe(false);
    expect(res.alreadyApplied).toBe(2);
  });

  it("reexecutar o mesmo cálculo produz zero invocações após a primeira aplicação (economia de créditos)", () => {
    const debts = [debt("d1", "pj1"), debt("d2", "pj1")];
    const debtsByPj = new Map([["pj1", debts]]);
    const currentByPj = new Map([["pj1", "pay1"]]);

    // 1ª chamada: nada aplicado ainda → 1 invocação
    const first = computePairsToInvoke({
      debtsByPj,
      currentByPj,
      glosaAppsByDebt: {},
    });
    expect(first.pairsToInvoke.size).toBe(1);

    // Simula edge criando aplicações para os dois débitos.
    const afterEdge: Record<string, GlosaAppLite[]> = {
      d1: [app("pay1", "proposto")],
      d2: [app("pay1", "proposto")],
    };

    // 2ª chamada: mesmo par → dedup elimina a invocação
    const second = computePairsToInvoke({
      debtsByPj,
      currentByPj,
      glosaAppsByDebt: afterEdge,
    });
    expect(second.pairsToInvoke.size).toBe(0);
    expect(second.alreadyApplied).toBe(2);
  });

  it("debtAppliedAt: paymentId null/undefined nunca retorna aplicação", () => {
    expect(debtAppliedAt({ d1: [app("pay1")] }, "d1", null)).toBeNull();
    expect(debtAppliedAt({ d1: [app("pay1")] }, "d1", undefined)).toBeNull();
  });
});
