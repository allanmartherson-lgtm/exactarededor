import { describe, it, expect } from "vitest";
import { classifyNonItemRow, partitionImportRows } from "../importRowFilter";

describe("importRowFilter", () => {
  it("descarta linha 'TOTAL A PAGAR' com valor e sem identificadores", () => {
    expect(
      classifyNonItemRow({ patient_name: "TOTAL A PAGAR", gross_amount: 5076.31 }),
    ).toBe("totalizador");
  });

  it("descarta totalizador na coluna médico", () => {
    expect(classifyNonItemRow({ doctor_name: "TOTAL GERAL", gross_amount: 100 })).toBe("totalizador");
  });

  it("descarta linha em branco com valor", () => {
    expect(classifyNonItemRow({ gross_amount: 5076.31 })).toBe("linha_vazia");
  });

  it("descarta linha só com descrição e valor (sem identificação)", () => {
    expect(classifyNonItemRow({ description: "Repasse do mês", gross_amount: 900 })).toBe(
      "sem_identificacao",
    );
  });

  it("mantém linha legítima com paciente e TUSS", () => {
    expect(
      classifyNonItemRow({
        patient_name: "MARIA SILVA",
        attendance_number: "123456",
        procedure_code: "30731015",
        gross_amount: 317.27,
      }),
    ).toBeNull();
  });

  it("não confunde procedimento com 'total' no nome", () => {
    expect(
      classifyNonItemRow({
        patient_name: "JOAO",
        attendance_number: "9",
        procedure_code: "30715016",
        procedure_name: "Protese total de joelho",
        gross_amount: 1200,
      }),
    ).toBeNull();
  });

  it("particiona mantendo 16 itens e 1 totalizador (caso LL CUIDADOS)", () => {
    const items = Array.from({ length: 16 }, (_, i) => ({
      patient_name: `PACIENTE ${i}`,
      attendance_number: String(1000 + i),
      procedure_code: "30731015",
      gross_amount: 317.269375,
      source_row_number: i + 2,
    }));
    const rows = [...items, { patient_name: "TOTAL A PAGAR", gross_amount: 5076.31, source_row_number: 18 }];
    const { kept, ignored } = partitionImportRows(rows);
    expect(kept).toHaveLength(16);
    expect(ignored).toHaveLength(1);
    expect(ignored[0].reason).toBe("totalizador");
    expect(kept.reduce((s, r) => s + r.gross_amount, 0)).toBeCloseTo(5076.31, 2);
  });
});
