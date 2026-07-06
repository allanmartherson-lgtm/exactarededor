import { describe, it, expect } from "vitest";
import { parseReconciliationBlock } from "./parseReconciliationBlock";

const fullPayload = {
  kind: "reconciliation_block",
  group_id: "g-1",
  payment_id: "p-1",
  hospital_id: "h-1",
  company_id: "c-1",
  company_name: "Clínica X",
  bruto_pedido: 1000,
  bruto_regra: 900,
  diferenca: 100,
  diff_pct: 10,
  attempted_status: "aguardando_validacao",
};

describe("parseReconciliationBlock · caminho válido", () => {
  it("JSON completo em details vira payload estruturado", () => {
    const r = parseReconciliationBlock({ details: JSON.stringify(fullPayload) });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("reconciliation_block");
    expect(r!.group_id).toBe("g-1");
    expect(r!.company_name).toBe("Clínica X");
    expect(r!.bruto_pedido).toBe(1000);
    expect(r!.diff_pct).toBe(10);
  });

  it("campos numéricos ausentes viram 0 (não undefined)", () => {
    const partial = { kind: "reconciliation_block", group_id: "g-1", payment_id: "p-1", hospital_id: "h-1", company_name: "X" };
    const r = parseReconciliationBlock({ details: JSON.stringify(partial) });
    expect(r).not.toBeNull();
    expect(r!.bruto_pedido).toBe(0);
    expect(r!.bruto_regra).toBe(0);
    expect(r!.diferenca).toBe(0);
    expect(r!.diff_pct).toBe(0);
  });

  it("company_id ausente vira null (não a string 'null')", () => {
    const noCompany = { ...fullPayload, company_id: null };
    const r = parseReconciliationBlock({ details: JSON.stringify(noCompany) });
    expect(r!.company_id).toBeNull();
  });

  it("company_name ausente vira string vazia", () => {
    const noName = { kind: "reconciliation_block", group_id: "g-1", payment_id: "p-1", hospital_id: "h-1" };
    const r = parseReconciliationBlock({ details: JSON.stringify(noName) });
    expect(r!.company_name).toBe("");
  });
});

describe("parseReconciliationBlock · rejeições (retorna null)", () => {
  it("error nulo ou undefined", () => {
    expect(parseReconciliationBlock(null)).toBeNull();
    expect(parseReconciliationBlock(undefined)).toBeNull();
  });

  it("kind diferente não é reconhecido", () => {
    const other = { ...fullPayload, kind: "outro_erro" };
    expect(parseReconciliationBlock({ details: JSON.stringify(other) })).toBeNull();
  });

  it("kind correto mas sem group_id retorna null", () => {
    const noGroup = { kind: "reconciliation_block", payment_id: "p-1" };
    expect(parseReconciliationBlock({ details: JSON.stringify(noGroup) })).toBeNull();
  });

  it("JSON malformado não lança exceção e retorna null", () => {
    expect(parseReconciliationBlock({ details: "{quebrado" })).toBeNull();
  });

  it("apenas message sem details estruturado retorna null", () => {
    expect(parseReconciliationBlock({ message: "Aprovação bloqueada em análise" })).toBeNull();
  });

  it("objeto de erro vazio retorna null", () => {
    expect(parseReconciliationBlock({})).toBeNull();
  });
});
