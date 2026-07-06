import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseBonusPacienteFile } from "./parseBonusPacienteFile";

// Helper: monta um File .xlsx em memória a partir de uma matriz (linha 0 = cabeçalho)
function makeFile(rows: (string | number | null)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const file = new File([ab], "bonus.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  // jsdom não implementa File.prototype.arrayBuffer(); adicionamos a partir do buffer já em memória.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => ab,
    writable: true,
  });
  return file;
}

describe("parseBonusPacienteFile · detecção de colunas", () => {
  it("detecta paciente e valor mesmo com maiúsculas/acentos/espaços", () => {
    return makeFile([["PACIENTE ", "Valor"], ["João", 100]]).arrayBuffer && parseBonusPacienteFile(
      makeFile([["PACIENTE ", "Valor"], ["João", 100]])
    ).then((r) => {
      expect(r.detected_columns.patient).toBeDefined();
      expect(r.detected_columns.value).toBeDefined();
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].gross_amount).toBe(100);
    });
  });

  it("lança erro se não houver coluna de valor", async () => {
    await expect(parseBonusPacienteFile(makeFile([["Paciente", "Convênio"], ["Ana", "Unimed"]]))).rejects.toThrow(/VALOR/i);
  });
});

describe("parseBonusPacienteFile · célula vazia vs zero (contrato)", () => {
  it("linha com valor vazio e sem paciente é ignorada", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], [null, null]]));
    expect(r.rows).toHaveLength(0);
  });

  it("linha com zero explícito e sem paciente é ignorada", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], [null, 0]]));
    expect(r.rows).toHaveLength(0);
  });

  it("linha com valor válido e paciente é importada", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Maria", 250]]));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].patient_name).toBe("Maria");
    expect(r.rows[0].gross_amount).toBe(250);
  });

  it("texto não-numérico numa célula preenchida gera issue de erro", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Bob", "abc"]]));
    const err = r.issues.find((i) => i.severity === "error" && /não numérico/i.test(i.message));
    expect(err).toBeDefined();
  });
});

describe("parseBonusPacienteFile · valores e formatos", () => {
  it("interpreta moeda brasileira 'R$ 1.234,56'", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Carlos", "R$ 1.234,56"]]));
    expect(r.rows[0].gross_amount).toBeCloseTo(1234.56, 2);
  });

  it("valor negativo gera issue de erro", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Dan", -50]]));
    const err = r.issues.find((i) => i.severity === "error" && /negativo/i.test(i.message));
    expect(err).toBeDefined();
  });

  it("valor muito alto gera issue de warning", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Eva", 2000000]]));
    const warn = r.issues.find((i) => i.severity === "warning" && /alto/i.test(i.message));
    expect(warn).toBeDefined();
  });
});

describe("parseBonusPacienteFile · linha de totalização", () => {
  it("linha só com valor (sem paciente/médico) vira declared_total, não item", async () => {
    const r = await parseBonusPacienteFile(makeFile([["Paciente", "Valor"], ["Ana", 100], [null, 100]]));
    expect(r.rows).toHaveLength(1);
    expect(r.declared_total).toBe(100);
  });
});
