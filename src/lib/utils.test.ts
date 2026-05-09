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
