/**
 * Testes de regressão para `classifyLine`.
 *
 * Bug histórico (#5260): nome TUSS oficial "Costectomia ... Cada Arco Adicional"
 * estava sendo classificado como `complemento_bonus` porque o classificador
 * fazia substring match em `procedure_name`. Resultado: o motor pulava
 * matching de regra para o item.
 */
import { describe, it, expect } from "vitest";
import { classifyLine, type ParsedRow } from "../parsePaymentFile";

type Row = Omit<ParsedRow, "tipo_linha" | "line_issues">;

const baseRow = (overrides: Partial<Row>): Row => ({
  doctor_name: "Dra Joana",
  doctor_document: "13256/DF",
  doctor_email: "",
  description: "",
  gross_amount: 100,
  company_name: null,
  company_id: null,
  attendance_number: "1",
  procedure_code: null,
  procedure_name: null,
  access_route: null,
  doctor_role: null,
  agreement_text: null,
  specialty: null,
  procedure_amount: null,
  quantity: null,
  procedure_date: null,
  patient_name: null,
  ...(overrides as any),
});

describe("classifyLine — guardas contra falso-positivo de complemento_bonus", () => {
  it("nome TUSS com 'Adicional' + procedure_code → procedimento, NÃO bonus", () => {
    const row = baseRow({
      procedure_code: "30601029",
      procedure_name: "Costectomia (Porte Para 1 Arco Costal, 30% Deste Porte Para Cada Arco Adicional)",
      description: "Costectomia (Porte Para 1 Arco Costal, 30% Deste Porte Para Cada Arco Adicional)",
    });
    expect(classifyLine(row)).toBe("procedimento");
  });

  it("nome TUSS com 'Complemento' + procedure_code → procedimento", () => {
    const row = baseRow({
      procedure_code: "12345678",
      procedure_name: "Procedimento complementar de teste",
      description: "Procedimento complementar de teste",
    });
    expect(classifyLine(row)).toBe("procedimento");
  });

  it("description com 'Bônus produtividade' SEM procedure_code → complemento_bonus", () => {
    const row = baseRow({
      procedure_code: null,
      procedure_name: null,
      description: "Bônus produtividade Q1",
    });
    expect(classifyLine(row)).toBe("complemento_bonus");
  });

  it("description com 'Complemento de pagamento' SEM procedure_code → complemento_bonus", () => {
    const row = baseRow({
      procedure_code: null,
      description: "Complemento de pagamento referente abril",
    });
    expect(classifyLine(row)).toBe("complemento_bonus");
  });

  it("palavra 'adicional' como SUBSTRING em outra palavra NÃO dispara bonus", () => {
    const row = baseRow({
      procedure_code: null,
      description: "Adicionalmente paguei", // contém "adicional" mas não como palavra inteira
    });
    // "Adicionalmente" começa com "adicional" mas continua com "mente" — não bate \b
    expect(classifyLine(row)).not.toBe("complemento_bonus");
  });

  it("procedure_code presente NUNCA vira complemento_bonus mesmo com description suspeita", () => {
    const row = baseRow({
      procedure_code: "30601029",
      description: "Bônus extra",
    });
    expect(classifyLine(row)).toBe("procedimento");
  });

  it("valor negativo continua sendo glosa", () => {
    const row = baseRow({ gross_amount: -100 });
    expect(classifyLine(row)).toBe("glosa_desconto");
  });
});
