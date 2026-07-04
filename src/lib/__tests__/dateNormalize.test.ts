import { describe, it, expect } from "vitest";
import { dbDateOrNull, isValidYmd } from "@/lib/dateNormalize";

describe("dbDateOrNull — normalizador de datas para gravação", () => {
  describe("entradas vazias/nulas", () => {
    it("null → null", () => expect(dbDateOrNull(null)).toBeNull());
    it("undefined → null", () => expect(dbDateOrNull(undefined)).toBeNull());
    it('"" → null', () => expect(dbDateOrNull("")).toBeNull());
    it('"   " → null', () => expect(dbDateOrNull("   ")).toBeNull());
  });

  describe("formato ISO YYYY-MM-DD", () => {
    it("data pura", () => expect(dbDateOrNull("2025-04-05")).toBe("2025-04-05"));
    it("data com espaços nas bordas", () => expect(dbDateOrNull("  2025-04-05  ")).toBe("2025-04-05"));
  });

  describe("timestamp ISO (evita regressão do erro de salvamento)", () => {
    // Bug real: coluna pag_data vinha como "2025-04-05T00:00:00.000Z"
    // e a versão antiga do conversor devolvia null, quebrando o INSERT.
    it("timestamp UTC completo", () => {
      expect(dbDateOrNull("2025-04-05T00:00:00.000Z")).toBe("2025-04-05");
    });
    it("timestamp sem millis", () => {
      expect(dbDateOrNull("2025-04-05T12:30:00Z")).toBe("2025-04-05");
    });
    it("timestamp com offset", () => {
      expect(dbDateOrNull("2025-04-05T12:30:00-03:00")).toBe("2025-04-05");
    });
    it("timestamp com espaço no lugar do T", () => {
      expect(dbDateOrNull("2025-04-05 00:00:00")).toBe("2025-04-05");
    });
  });

  describe("formato BR DD/MM/YYYY", () => {
    it("com barras", () => expect(dbDateOrNull("05/04/2025")).toBe("2025-04-05"));
    it("com hífens", () => expect(dbDateOrNull("05-04-2025")).toBe("2025-04-05"));
    it("dia/mês de um dígito", () => expect(dbDateOrNull("5/4/2025")).toBe("2025-04-05"));
  });

  describe("objeto Date", () => {
    it("Date UTC", () => {
      const d = new Date(Date.UTC(2025, 3, 5));
      expect(dbDateOrNull(d)).toBe("2025-04-05");
    });
  });

  describe("serial do Excel", () => {
    it("serial 45752 = 2025-04-05", () => {
      // Excel epoch: 1899-12-30. 45752 dias → 05/04/2025.
      expect(dbDateOrNull("45752")).toBe("2025-04-05");
    });
    it("número pequeno (fora da faixa) → null", () => {
      expect(dbDateOrNull("42")).toBeNull();
    });
  });

  describe("datas inválidas — nunca lança, sempre null", () => {
    it("mês 13", () => expect(dbDateOrNull("2025-13-01")).toBeNull());
    it("dia 32", () => expect(dbDateOrNull("2025-01-32")).toBeNull());
    it("29/02 em ano não bissexto", () => expect(dbDateOrNull("29/02/2025")).toBeNull());
    it("ano fora da faixa (1800)", () => expect(dbDateOrNull("1800-01-01")).toBeNull());
    it("string arbitrária", () => expect(dbDateOrNull("hoje")).toBeNull());
    it("objeto Date inválido", () => expect(dbDateOrNull(new Date("xxx"))).toBeNull());
  });

  describe("casos que valem para o pipeline TASY/Repasse", () => {
    it("29/02 em ano bissexto é aceito", () => {
      expect(dbDateOrNull("29/02/2024")).toBe("2024-02-29");
    });
    it("normaliza sempre para YYYY-MM-DD com zero à esquerda", () => {
      expect(dbDateOrNull("1/1/2025")).toBe("2025-01-01");
    });
  });
});

describe("isValidYmd", () => {
  it("aceita data válida", () => expect(isValidYmd(2025, 4, 5)).toBe(true));
  it("rejeita mês 0", () => expect(isValidYmd(2025, 0, 5)).toBe(false));
  it("rejeita NaN", () => expect(isValidYmd(NaN, 1, 1)).toBe(false));
  it("rejeita 31/04 (mês só com 30)", () => expect(isValidYmd(2025, 4, 31)).toBe(false));
});
