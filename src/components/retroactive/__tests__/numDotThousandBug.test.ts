import { describe, it, expect } from "vitest";

// Reproduz a função `num` do RetroactiveReconciliationsTab.tsx para blindar
// contra a regressão do "dot-thousand": valores como "900.025" (unit_tasy
// derivado de 1800.05/2 em re-hidratação) NÃO devem ser interpretados como
// R$ 900.025,00 — devem ser R$ 900,03.
function num(v: string | number | undefined | null): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

describe("num() — regressão dot-thousand", () => {
  it("String(number) com 3 decimais deve preservar decimais (não inflar 1000×)", () => {
    // Bug histórico: num("900.025") => 900025. Correto: 900.025.
    expect(num("900.025")).toBeCloseTo(900.025, 6);
    expect(num(String(1800.05 / 2))).toBeCloseTo(900.025, 6);
  });

  it("BR ambíguo com múltiplos pontos ainda é milhar", () => {
    expect(num("1.234.567")).toBe(1234567);
  });

  it("BR clássico com vírgula", () => {
    expect(num("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(num("50.000,00")).toBe(50000);
    expect(num("326,06")).toBeCloseTo(326.06, 6);
  });

  it("Decimais US puros", () => {
    expect(num("2470.65")).toBeCloseTo(2470.65, 6);
    expect(num("1058.85")).toBeCloseTo(1058.85, 6);
    expect(num("741.2")).toBeCloseTo(741.2, 6);
  });

  it("Números puros", () => {
    expect(num(1800.05)).toBeCloseTo(1800.05, 6);
    expect(num("900025")).toBe(900025);
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
  });
});
