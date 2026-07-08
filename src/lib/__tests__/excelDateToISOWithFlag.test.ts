import { describe, it, expect } from "vitest";
import { excelDateToISOWithFlag } from "../parsePaymentFile";

describe("excelDateToISOWithFlag", () => {
  describe("entradas vazias/nulas", () => {
    it("retorna null para null", () => {
      expect(excelDateToISOWithFlag(null)).toEqual({ iso: null, hasTime: false });
    });
    it("retorna null para undefined", () => {
      expect(excelDateToISOWithFlag(undefined)).toEqual({ iso: null, hasTime: false });
    });
    it("retorna null para string vazia", () => {
      expect(excelDateToISOWithFlag("")).toEqual({ iso: null, hasTime: false });
    });
  });

  describe("serial Excel numérico", () => {
    it("converte serial 46165 (número) para data válida sem estourar ano", () => {
      const r = excelDateToISOWithFlag(46165);
      expect(r.iso).not.toBeNull();
      const year = new Date(r.iso!).getUTCFullYear();
      expect(year).toBeGreaterThanOrEqual(2020);
      expect(year).toBeLessThanOrEqual(2030);
      expect(r.hasTime).toBe(false);
    });
    it("serial 1 corresponde a 1900 (base do Excel)", () => {
      const r = excelDateToISOWithFlag(1);
      expect(r.iso).not.toBeNull();
      expect(new Date(r.iso!).getUTCFullYear()).toBe(1900);
    });
  });

  describe("serial Excel em string (regressão)", () => {
    it('converte "46165" (string) sem virar ano 46165', () => {
      const r = excelDateToISOWithFlag("46165");
      expect(r.iso).not.toBeNull();
      const year = new Date(r.iso!).getUTCFullYear();
      expect(year).toBeGreaterThanOrEqual(2020);
      expect(year).toBeLessThanOrEqual(2030);
      expect(r.hasTime).toBe(false);
    });
    it("rejeita serial absurdo (> 200000)", () => {
      expect(excelDateToISOWithFlag("999999")).toEqual({ iso: null, hasTime: false });
    });
    it("rejeita 0 e negativos implícitos", () => {
      expect(excelDateToISOWithFlag("0")).toEqual({ iso: null, hasTime: false });
    });
  });

  describe("strings de data comuns", () => {
    it("aceita formato brasileiro dd/mm/aaaa", () => {
      const r = excelDateToISOWithFlag("15/03/2025");
      expect(r.iso).toBe("2025-03-15T15:00:00.000Z");
      expect(r.hasTime).toBe(false);
    });
    it("aceita dd/mm/aa (2 dígitos no ano)", () => {
      const r = excelDateToISOWithFlag("15/03/25");
      expect(r.iso).toBe("2025-03-15T15:00:00.000Z");
    });
    it("aceita dd/mm/aaaa hh:mm com hasTime=true", () => {
      const r = excelDateToISOWithFlag("15/03/2025 10:30");
      expect(r.iso).toBe("2025-03-15T10:30:00.000Z");
      expect(r.hasTime).toBe(true);
    });
    it("aceita ISO aaaa-mm-dd", () => {
      const r = excelDateToISOWithFlag("2025-03-15");
      expect(r.iso).toBe("2025-03-15T15:00:00.000Z");
    });
  });

  describe("Date nativo", () => {
    it("aceita Date sem horário", () => {
      const d = new Date(Date.UTC(2025, 2, 15));
      const r = excelDateToISOWithFlag(d);
      expect(r.iso).toBe("2025-03-15T00:00:00.000Z");
      expect(r.hasTime).toBe(false);
    });
    it("aceita Date com horário e marca hasTime", () => {
      const d = new Date(Date.UTC(2025, 2, 15, 10, 30));
      const r = excelDateToISOWithFlag(d);
      expect(r.hasTime).toBe(true);
    });
  });

  describe("entradas inválidas", () => {
    it("retorna null para texto não-data", () => {
      expect(excelDateToISOWithFlag("procedimento")).toEqual({ iso: null, hasTime: false });
    });
    it("retorna null para data fora do range plausível (< 1970) via fallback Date", () => {
      expect(excelDateToISOWithFlag("Jan 1 1800").iso).toBeNull();
    });
    it("retorna null para data fora do range plausível (> 2100) via fallback Date", () => {
      expect(excelDateToISOWithFlag("Jan 1 2200").iso).toBeNull();
    });
  });
});
