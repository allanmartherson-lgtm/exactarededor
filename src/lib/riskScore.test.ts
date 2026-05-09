import { describe, it, expect } from "vitest";
import { calculateFinancialRisk } from "./riskScore";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

describe("calculateFinancialRisk", () => {
  const createItem = (amount: number, status: "aprovado" | "alerta" | "reprovado", tipo: string = "servico", exception: boolean = false): PaymentItemRow => ({
    id: Math.random().toString(),
    gross_amount: amount,
    ai_status: status,
    tipo_linha: tipo,
    authorized_exception: exception,
    ai_findings: { alerts: status !== "aprovado" ? ["Alerta"] : [] },
    payment_id: "test-payment",
    doctor_name: "Test Doctor",
    company_name: "Test Company",
    created_at: new Date().toISOString(),
  } as any);

  it("should return low risk (baixo) for small amounts and no alerts", () => {
    const items = [createItem(100, "aprovado")];
    const risk = calculateFinancialRisk(items);
    expect(risk.level).toBe("baixo");
    expect(risk.score).toBe(0);
    expect(risk.valorEmRisco).toBe(0);
  });

  it("should correctly classify medium risk (medio)", () => {
    // 20% em alerta: (0.2 * 30) = 6 score base. 
    // Com volume baixo (<1000), score final ~6.
    // Mas 50% em alerta: (0.5 * 30) = 15 score base -> medio (>= 15)
    const items = [
      createItem(500, "aprovado"),
      createItem(500, "alerta")
    ];
    const risk = calculateFinancialRisk(items);
    expect(risk.level).toBe("medio");
    expect(risk.score).toBe(15);
  });

  it("should correctly classify high risk (alto)", () => {
    // 50% reprovado: (0.5 * 70) = 35 score base -> alto (>= 35)
    const items = [
      createItem(500, "aprovado"),
      createItem(500, "reprovado")
    ];
    const risk = calculateFinancialRisk(items);
    expect(risk.level).toBe("alto");
    expect(risk.score).toBe(35);
  });

  it("should correctly classify critical risk (critico)", () => {
    // 100% reprovado: (1.0 * 70) = 70 score base -> critico (>= 60)
    const items = [
      createItem(1000, "reprovado")
    ];
    const risk = calculateFinancialRisk(items);
    expect(risk.level).toBe("critico");
    expect(risk.score).toBe(70);
  });

  it("should apply volume bonus correctly", () => {
    // 100% aprovado, mas R$ 100.000. 
    // log10(100.000 / 1000) * 5 = log10(100) * 5 = 2 * 5 = 10
    const items = [createItem(100000, "aprovado")];
    const risk = calculateFinancialRisk(items);
    expect(risk.score).toBe(10); 
    expect(risk.level).toBe("baixo"); // 10 < 15
  });

  it("should cap volume bonus at 15", () => {
    // R$ 10.000.000 -> log10(10000) * 5 = 4 * 5 = 20 -> capped at 15
    const items = [createItem(10000000, "aprovado")];
    const risk = calculateFinancialRisk(items);
    expect(risk.score).toBe(15);
    expect(risk.level).toBe("medio"); // 15 >= 15
  });

  it("should ignore glosa_desconto for total and risk calculation", () => {
    const items = [
      createItem(1000, "aprovado"),
      createItem(-200, "reprovado", "glosa_desconto")
    ];
    const risk = calculateFinancialRisk(items);
    // Valor total deve ser 1000, ignorando a glosa
    expect(risk.valorEmRisco).toBe(0);
    expect(risk.score).toBe(0);
  });

  it("should ignore items with authorized_exception", () => {
    const items = [
      createItem(1000, "aprovado"),
      createItem(1000, "reprovado", "servico", true) // exception!
    ];
    const risk = calculateFinancialRisk(items);
    // Valor total = 2000, mas o reprovado é ignorado no risco
    expect(risk.valorEmRisco).toBe(0);
    // log10(2000/1000)*5 = 0.3*5 = 1.5 -> round 2
    expect(risk.score).toBe(2); 
  });

  it("should handle total_amount = 0 without crashing", () => {
    const items = [createItem(0, "reprovado")];
    const risk = calculateFinancialRisk(items);
    expect(risk.score).toBe(0);
    expect(risk.percentualRisco).toBe(0);
    expect(risk.level).toBe("baixo");
  });

  it("should combine base score and volume bonus", () => {
    // 100% reprovado em R$ 10.000
    // base = 70. bonus = log10(10)*5 = 5. total = 75.
    const items = [createItem(10000, "reprovado")];
    const risk = calculateFinancialRisk(items);
    expect(risk.score).toBe(75);
    expect(risk.level).toBe("critico");
  });
});
