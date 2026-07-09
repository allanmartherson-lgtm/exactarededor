import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readRawSheet, parseCellMoney } from "../RetroactiveMappingWizard";

const makeFile = (content: string | ArrayBuffer, name: string, type: string): File => {
  const buf =
    typeof content === "string"
      ? (() => {
          const enc = new TextEncoder().encode(content);
          return enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
        })()
      : content;
  const file = {
    name,
    type,
    arrayBuffer: async () => buf,
  } as File;
  return file;
};

describe("readRawSheet — moeda BR do TASY", () => {
  it("preserva o texto formatado da coluna Valor antes do mapeamento retroativo", async () => {
    const htmlXls = `
      <html><body><table>
        <tr><td>Valor</td><td>Atendimento</td></tr>
        <tr><td>326,06</td><td>9178967</td></tr>
        <tr><td>1.086,883125</td><td>9183361</td></tr>
      </table></body></html>
    `;
    const file = makeFile(htmlXls, "tasy.xls", "application/vnd.ms-excel");
    const { rows } = await readRawSheet(file);
    expect(rows[0].Valor).toBe("326,06");
    expect(rows[1].Valor).toBe("1.086,883125");
  });

  it("preserva variações de cabeçalho de valor (Vl., R$, Total) em HTML/XLS", async () => {
    const htmlXls = `
      <html><body><table>
        <tr><td>Vl. Repasse</td><td>Valor Procedimento</td><td>R$ Total</td></tr>
        <tr><td>1.234,56</td><td>52.001.281,30</td><td>0,00</td></tr>
        <tr><td>629,765</td><td>10,00</td><td>-15,50</td></tr>
      </table></body></html>
    `;
    const file = makeFile(htmlXls, "tasy_repasse.xls", "application/vnd.ms-excel");
    const { rows, headers } = await readRawSheet(file);
    expect(headers).toContain("Vl. Repasse");
    expect(headers).toContain("Valor Procedimento");
    expect(headers).toContain("R$ Total");
    expect(rows[0]["Vl. Repasse"]).toBe("1.234,56");
    expect(rows[0]["Valor Procedimento"]).toBe("52.001.281,30");
    expect(rows[0]["R$ Total"]).toBe("0,00");
    expect(rows[1]["Vl. Repasse"]).toBe("629,765");
    expect(rows[1]["R$ Total"]).toBe("-15,50");
  });

  it("preserva moeda BR em XLSX binário (não HTML) com célula formatada", async () => {
    // z (number format) sobrevive ao write→read; SheetJS regenera .w a partir dele.
    const ws: XLSX.WorkSheet = {
      "!ref": "A1:B3",
      A1: { t: "s", v: "Valor" },
      B1: { t: "s", v: "Atendimento" },
      A2: { t: "n", v: 326.06, z: "#,##0.00" },
      B2: { t: "s", v: "9178967" },
      A3: { t: "n", v: 1086.883125, z: "#,##0.000000" },
      B3: { t: "s", v: "9183361" },
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = makeFile(
      buf,
      "tasy.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const { rows } = await readRawSheet(file);
    expect(rows[0].Valor).toBe("326,06");
    expect(rows[1].Valor).toBe("1.086,883125");
  });

  it("não infla o total quando várias linhas TASY chegam com moeda BR", async () => {
    const linhas = Array.from({ length: 10 })
      .map((_, i) => `<tr><td>326,06</td><td>${9000000 + i}</td></tr>`)
      .join("");
    const htmlXls = `<html><body><table>
      <tr><td>Valor</td><td>Atendimento</td></tr>${linhas}
    </table></body></html>`;
    const file = makeFile(htmlXls, "tasy_bulk.xls", "application/vnd.ms-excel");
    const { rows } = await readRawSheet(file);
    const soma = rows.reduce((acc, r) => acc + Number(parseCellMoney(r.Valor) || "0"), 0);
    // Soma esperada = 3.260,60 — não pode virar 326.060 (inflação por perda de vírgula).
    expect(soma).toBeCloseTo(3260.6, 2);
  });
});

describe("parseCellMoney — formatos reais do TASY", () => {
  it.each([
    ["326,06", 326.06],
    ["1.086,883125", 1086.883125],
    ["52.001.281,30", 52001281.3],
    ["0,00", 0],
    ["-15,50", -15.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56], // formato US
    ["629.765", 629.765], // um único ponto = decimal no TASY (não milhar)
    ["R$ 1.200,00", 1200],
    ["", null],
  ])("parseia '%s' corretamente", (input, expected) => {
    const parsed = parseCellMoney(input);
    if (expected === null) {
      expect(parsed).toBe("");
    } else {
      expect(Number(parsed)).toBeCloseTo(expected, 6);
    }
  });
});
