/**
 * INVARIANTE: mapeamento manual SEMPRE vence — independente do dado,
 * coluna, valor concorrente, presença de aliases canônicos ou heurísticas.
 *
 * Contrato testado:
 *   ∀ rawRow, ∀ header escolhido pelo analista:
 *     - Se header ∈ rawRow → resultado = normalizeNumericValue(rawRow[header])
 *     - Se header ∉ rawRow → resultado = 0
 *     - grossAuthoritative / procAuthoritative SEMPRE true
 *     - Nenhum outro campo da linha influencia o resultado
 */
import { describe, it, expect } from "vitest";
import {
  resolvePaymentAmounts,
  REPASSE_ALIASES,
  PROC_AMOUNT_ALIASES,
  GROSS_FALLBACK_ALIASES,
} from "@/lib/resolvePaymentAmounts";
import { normalizeNumericValue } from "@/lib/utils";

// Linha "armadilha": contém TODOS os aliases conhecidos com valores
// diferentes do header mapeado. Se algum vazar, o teste quebra.
const buildTrapRow = (mappedHeader: string, mappedValue: unknown) => {
  const row: Record<string, unknown> = { [mappedHeader]: mappedValue };
  // Espalha todos os aliases canônicos com valores ruidosos.
  [...REPASSE_ALIASES, ...PROC_AMOUNT_ALIASES, ...GROSS_FALLBACK_ALIASES].forEach(
    (alias, idx) => {
      // Não sobrescreve o header mapeado.
      if (alias !== mappedHeader) row[alias] = (idx + 1) * 111;
    },
  );
  // Heurísticas comuns também espalhadas.
  if (mappedHeader !== "Valor Tot") row["Valor Tot"] = 9999;
  if (mappedHeader !== "Valor") row["Valor"] = 8888;
  if (mappedHeader !== "Valor Bruto") row["Valor Bruto"] = 7777;
  return row;
};

// Conjunto de valores variados que devem ser respeitados COMO ESTÃO.
const valueCases: Array<{ label: string; raw: unknown; expected: number; invalid?: boolean }> = [
  { label: "número 0", raw: 0, expected: 0 },
  { label: "número positivo", raw: 1500.5, expected: 1500.5 },
  { label: "número negativo (inválido — preserva valor + flag)", raw: -100, expected: -100, invalid: true },
  { label: "string '0'", raw: "0", expected: 0 },
  { label: "string BR '1.234,56'", raw: "1.234,56", expected: 1234.56 },
  { label: "string US '1500.50'", raw: "1500.50", expected: 1500.5 },
  { label: "string com R$ 'R$ 999,00'", raw: "R$ 999,00", expected: 999 },
  { label: "undefined", raw: undefined, expected: 0 },
  { label: "null", raw: null, expected: 0 },
  { label: "string vazia ''", raw: "", expected: 0 },
  { label: "espaços '   '", raw: "   ", expected: 0 },
  { label: "string lixo 'abc'", raw: "abc", expected: 0, invalid: true },
];

// Headers de diferentes naturezas (canônicos, heurísticos, totalmente arbitrários).
const headerCases = [
  "Vl a Repassar",                  // alias canônico de repasse
  "Valor Tot",                       // header da heurística antiga
  "Valor",                           // header de fallback
  "Valor Convênio",                  // alias canônico de procedimento
  "XYZ Coluna Maluca Do Hospital",   // arbitrário
  "Repasse 200% Acordo Especial",    // arbitrário longo
  "  Header Com Espaços  ",          // edge: espaços nas bordas
];

describe("INVARIANTE: mapeamento manual SEMPRE vence (gross_amount)", () => {
  headerCases.forEach((header) => {
    valueCases.forEach(({ label, raw, expected, invalid }) => {
      it(`gross='${header}' valor=${label} → lê direto, ignora ruído`, () => {
        const row = buildTrapRow(header, raw);
        const result = resolvePaymentAmounts(row, { gross_amount: header });
        expect(result.gross_amount).toBe(expected);
        expect(result.grossAuthoritative).toBe(true);
        if (invalid) expect(result.valor_invalido).toBe(true);
      });
    });
  });

  it("header mapeado AUSENTE da linha → 0 autoritativo, ignora qualquer alias/heurística da linha", () => {
    const row = buildTrapRow("Outro Header", 12345); // header mapeado não existe
    const result = resolvePaymentAmounts(row, { gross_amount: "Header Inexistente" });
    expect(result.gross_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
  });
});

describe("INVARIANTE: mapeamento manual SEMPRE vence (procedure_amount)", () => {
  headerCases.forEach((header) => {
    valueCases.forEach(({ label, raw, expected, invalid }) => {
      it(`procedure='${header}' valor=${label} → lê direto, ignora ruído`, () => {
        const row = buildTrapRow(header, raw);
        const result = resolvePaymentAmounts(row, { procedure_amount: header });
        expect(result.procedure_amount).toBe(expected);
        expect(result.procAuthoritative).toBe(true);
        if (invalid) expect(result.valor_invalido).toBe(true);
      });
    });
  });

  it("header mapeado AUSENTE da linha → 0 autoritativo (procedure_amount)", () => {
    const row = buildTrapRow("Outro", 99999);
    const result = resolvePaymentAmounts(row, { procedure_amount: "Nao Existe" });
    expect(result.procedure_amount).toBe(0);
    expect(result.procAuthoritative).toBe(true);
  });
});

describe("INVARIANTE: gross e procedure mapeados são totalmente independentes", () => {
  it("alterar gross_amount mapeado não afeta procedure_amount mapeado (e vice-versa)", () => {
    const row: Record<string, unknown> = {
      "G Custom": 100,
      "P Custom": 0,
      "Vl a Repassar": 9999,
      "Valor Convênio": 8888,
      "Valor Tot": 7777,
    };
    const result = resolvePaymentAmounts(row, {
      gross_amount: "G Custom",
      procedure_amount: "P Custom",
    });
    expect(result.gross_amount).toBe(100);
    expect(result.procedure_amount).toBe(0);
    expect(result.grossAuthoritative).toBe(true);
    expect(result.procAuthoritative).toBe(true);
  });

  it("o valor lido bate exatamente com normalizeNumericValue do header mapeado", () => {
    // Property check direto: para um conjunto de valores, o pipeline = normalizador puro.
    valueCases.forEach(({ raw }) => {
      const row = buildTrapRow("X Custom", raw);
      const result = resolvePaymentAmounts(row, {
        gross_amount: "X Custom",
        procedure_amount: "X Custom",
      });
      const direct = normalizeNumericValue(raw).value;
      expect(result.gross_amount).toBe(direct);
      expect(result.procedure_amount).toBe(direct);
    });
  });
});
