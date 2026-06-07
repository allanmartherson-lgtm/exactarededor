import { describe, it, expect } from "vitest";
import {
  ANALISE_ONLY_FIELDS,
  asItemForMode,
  stripForMode,
} from "../paymentItem";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

function makeRow(over: Partial<PaymentItemRow> = {}): PaymentItemRow {
  return {
    id: "x",
    gross_amount: 1234,
    procedure_amount: 1000,
    expected_amount: 500,
    ai_findings: null,
  } as unknown as PaymentItemRow;
}

describe("paymentItem types · sanitização por modo", () => {
  it("ANALISE_ONLY_FIELDS contém gross_amount", () => {
    expect(ANALISE_ONLY_FIELDS).toContain("gross_amount");
  });

  it("stripForMode('analise') não toca em campos análise-only", () => {
    const out = stripForMode(makeRow(), "analise");
    expect(out.gross_amount).toBe(1234);
  });

  it("stripForMode('confeccao') zera gross_amount no patch", () => {
    const out = stripForMode(makeRow(), "confeccao");
    expect(out.gross_amount).toBeNull();
  });

  it("asItemForMode('confeccao') retorna item sem valor de comparação", () => {
    const item = asItemForMode(makeRow(), "confeccao");
    expect((item as any).gross_amount).toBeNull();
    expect((item as any).procedure_amount).toBe(1000);
    expect((item as any).expected_amount).toBe(500);
  });

  it("asItemForMode('analise') preserva integralmente a row", () => {
    const item = asItemForMode(makeRow(), "analise");
    expect((item as any).gross_amount).toBe(1234);
  });
});
