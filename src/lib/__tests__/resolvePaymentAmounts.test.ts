/**
 * Garante que valores explicitamente mapeados pelo analista (ou colunas
 * canônicas como "Vl a Repassar") com valor 0 NÃO sejam sobrescritos pela
 * heurística genérica de "Valor"/"Valor Tot". Regressão histórica: regra
 * de não-pagamento Sul América gravava 95 (Valor Tot) em vez de 0.
 */
import { describe, it, expect } from "vitest";
import { resolvePaymentAmounts } from "@/lib/resolvePaymentAmounts";

describe("resolvePaymentAmounts", () => {
  describe("repasse=0 autoritativo", () => {
    it("preserva repasse 0 quando analista mapeou gross_amount (mesmo com 'Valor Tot' presente)", () => {
      const row = {
        "Vl a Repassar": 0,
        "Valor Tot": 95,
        "Médico": "Dr X",
      };
      const result = resolvePaymentAmounts(row, { gross_amount: "Vl a Repassar" });
      expect(result.gross_amount).toBe(0);
      expect(result.grossAuthoritative).toBe(true);
    });

    it("preserva repasse 0 quando coluna canônica 'Valor Repasse' existe (sem mapeamento manual)", () => {
      const row = {
        "Valor Repasse": 0,
        "Valor Tot": 95,
      };
      const result = resolvePaymentAmounts(row);
      expect(result.gross_amount).toBe(0);
      expect(result.grossAuthoritative).toBe(true);
    });

    it("usa heurística (Valor Tot) apenas quando nenhuma coluna de repasse existe", () => {
      const row = { "Valor Tot": 95 };
      const result = resolvePaymentAmounts(row);
      expect(result.gross_amount).toBe(95);
      expect(result.grossAuthoritative).toBe(false);
    });

    it("preserva repasse 0 mesmo quando string '0' (formato BR)", () => {
      const row = {
        "Vl Repasse": "0",
        "Valor Tot": "1.234,56",
      };
      const result = resolvePaymentAmounts(row, { gross_amount: "Vl Repasse" });
      expect(result.gross_amount).toBe(0);
    });

    it("repasse com valor > 0 mapeado é respeitado", () => {
      const row = {
        "Vl a Repassar": "1.500,00",
        "Valor Tot": 95,
      };
      const result = resolvePaymentAmounts(row, { gross_amount: "Vl a Repassar" });
      expect(result.gross_amount).toBe(1500);
    });
  });

  describe("procedure_amount=0 autoritativo", () => {
    it("preserva procedure_amount 0 quando analista mapeou explicitamente", () => {
      const row = {
        "Valor Convênio": 0,
        "Vl Repasse": 500,
      };
      const result = resolvePaymentAmounts(row, { procedure_amount: "Valor Convênio" });
      expect(result.procedure_amount).toBe(0);
      expect(result.procAuthoritative).toBe(true);
    });

    it("preserva procedure_amount 0 quando coluna canônica existe (sem mapeamento)", () => {
      const row = {
        "Valor Procedimento": 0,
        "Vl Repasse": 500,
      };
      const result = resolvePaymentAmounts(row);
      expect(result.procedure_amount).toBe(0);
      expect(result.procAuthoritative).toBe(true);
    });

    it("cai para grossFromAny quando nenhuma coluna de procedimento existe", () => {
      const row = { "Vl Repasse": 500 };
      const result = resolvePaymentAmounts(row);
      expect(result.procedure_amount).toBe(500);
      expect(result.procAuthoritative).toBe(false);
    });
  });

  describe("ambos os campos juntos", () => {
    it("repasse=0 e procedure_amount=0 mapeados → ambos zerados, valor_invalido=false", () => {
      const row = {
        "Vl a Repassar": 0,
        "Valor Convênio": 0,
        "Valor Tot": 95,
      };
      const result = resolvePaymentAmounts(row, {
        gross_amount: "Vl a Repassar",
        procedure_amount: "Valor Convênio",
      });
      expect(result.gross_amount).toBe(0);
      expect(result.procedure_amount).toBe(0);
      expect(result.valor_invalido).toBe(false);
    });
  });
});
