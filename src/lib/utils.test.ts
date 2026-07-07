import { describe, it, expect } from "vitest";
import { normalizeNumericValue } from "./utils";

describe("normalizeNumericValue", () => {
  it("should handle 5687,4 (sem milhar, vírgula decimal)", () => {
    const result = normalizeNumericValue("5687,4");
    expect(result.value).toBe(5687.4);
    expect(result.invalid).toBe(false);
  });

  it("should handle 5.687,40 (ponto milhar, vírgula decimal)", () => {
    const result = normalizeNumericValue("5.687,40");
    expect(result.value).toBe(5687.4);
    expect(result.invalid).toBe(false);
  });

  it("should handle Tasy values with thousand point and 6 decimal digits", () => {
    const result = normalizeNumericValue("1.086,883125");
    expect(result.value).toBeCloseTo(1086.883125, 6);
    expect(result.invalid).toBe(false);
  });

  it("should handle Tasy values with comma decimals that SheetJS often corrupts", () => {
    expect(normalizeNumericValue("326,06").value).toBe(326.06);
    expect(normalizeNumericValue("401,14").value).toBe(401.14);
    expect(normalizeNumericValue("802,28").value).toBe(802.28);
  });

  it("should handle 5687.40 (ponto decimal, sem milhar)", () => {
    const result = normalizeNumericValue("5687.40");
    expect(result.value).toBe(5687.4);
    expect(result.invalid).toBe(false);
  });

  it("should handle 5.687 (ponto milhar, sem centavos)", () => {
    const result = normalizeNumericValue("5.687");
    expect(result.value).toBe(5687);
    expect(result.invalid).toBe(false);
  });

  it("should handle currency symbols and spaces", () => {
    const result = normalizeNumericValue("R$ 5.687,40");
    expect(result.value).toBe(5687.4);
    expect(result.invalid).toBe(false);
  });

  it("should handle negative values as invalid", () => {
    const result = normalizeNumericValue("-100,00");
    expect(result.invalid).toBe(true);
  });

  it("should handle NaN/non-numeric strings as invalid", () => {
    const result = normalizeNumericValue("abc");
    expect(result.invalid).toBe(true);
  });

  it("should handle empty values", () => {
    expect(normalizeNumericValue("").value).toBe(0);
    expect(normalizeNumericValue(null).value).toBe(0);
    expect(normalizeNumericValue(undefined).value).toBe(0);
  });
});
