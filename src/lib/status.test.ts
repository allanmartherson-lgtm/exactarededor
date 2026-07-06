import { describe, it, expect } from "vitest";
import {
  displayPaymentStatus,
  normalizePaymentTypeCode,
  formatCurrency,
  formatCompetence,
  formatDateOnly,
} from "./status";

describe("displayPaymentStatus", () => {
  it("em confecção usa confeccao_status, ignorando status", () => {
    const r = displayPaymentStatus({ status: "rascunho", analysis_mode: "confeccao", confeccao_status: "confeccao_concluida" });
    expect(r.label).toBe("Confecção concluída");
    expect(r.tone).toBe("info");
  });
  it("em confecção sem confeccao_status cai no default 'Em confecção'", () => {
    const r = displayPaymentStatus({ status: "rascunho", analysis_mode: "confeccao", confeccao_status: null });
    expect(r.label).toBe("Em confecção");
    expect(r.tone).toBe("warning");
  });
  it("fora de confecção usa o status normal", () => {
    const r = displayPaymentStatus({ status: "aprovado", analysis_mode: "padrao" });
    expect(r.label).toBe("Aprovado");
    expect(r.tone).toBe("success");
  });
  it("status ausente cai em rascunho", () => {
    const r = displayPaymentStatus({});
    expect(r.label).toBe("Rascunho");
    expect(r.tone).toBe("muted");
  });
});

describe("normalizePaymentTypeCode", () => {
  it("converte o code legado producao para procedimento", () => {
    expect(normalizePaymentTypeCode("producao")).toBe("procedimento");
  });
  it("mantém outros codes intactos", () => {
    expect(normalizePaymentTypeCode("remessa")).toBe("remessa");
    expect(normalizePaymentTypeCode("plantao")).toBe("plantao");
  });
  it("null ou vazio viram string vazia", () => {
    expect(normalizePaymentTypeCode(null)).toBe("");
    expect(normalizePaymentTypeCode(undefined)).toBe("");
    expect(normalizePaymentTypeCode("")).toBe("");
  });
});

describe("formatCurrency", () => {
  it("formata número como BRL", () => {
    expect(formatCurrency(1234.5)).toBe("R$\u00A01.234,50");
  });
  it("aceita string numérica (float com ponto)", () => {
    expect(formatCurrency("1234.5")).toBe("R$\u00A01.234,50");
  });
  it("null e undefined viram R$ 0,00", () => {
    expect(formatCurrency(null)).toBe("R$\u00A00,00");
    expect(formatCurrency(undefined)).toBe("R$\u00A00,00");
  });
});

describe("formatCompetence", () => {
  it("data única formata mês/ano por extenso", () => {
    expect(formatCompetence("2026-03-01")).toBe("março de 2026");
  });
  it("não regride o mês por fuso (dia 01 continua no mês correto)", () => {
    expect(formatCompetence("2026-03-01")).not.toContain("fevereiro");
  });
  it("array de 1 data comporta-se como data única", () => {
    expect(formatCompetence(["2026-03-01"])).toBe("março de 2026");
  });
  it("array de 2 a 3 datas junta com bullet", () => {
    const r = formatCompetence(["2026-01-01", "2026-02-01"]);
    expect(r).toContain("•");
  });
  it("array de 4+ datas vira intervalo com contagem", () => {
    const r = formatCompetence(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(r).toContain("→");
    expect(r).toContain("(4)");
  });
  it("vazio e null viram travessão", () => {
    expect(formatCompetence(null)).toBe("—");
    expect(formatCompetence([])).toBe("—");
  });
});

describe("formatDateOnly", () => {
  it("null vira travessão", () => {
    expect(formatDateOnly(null)).toBe("—");
  });
});
