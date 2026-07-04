import { describe, it, expect } from "vitest";
import {
  deriveTipoAnaliseFromCalcType,
  formatPrevistoSourceLabel,
} from "@/lib/tvrSimulationMapping";

describe("deriveTipoAnaliseFromCalcType", () => {
  it("percentual_sobre_convenio → valor", () => {
    expect(deriveTipoAnaliseFromCalcType("percentual_sobre_convenio")).toBe("valor");
  });
  it("percentual_convenio (alias) → valor", () => {
    expect(deriveTipoAnaliseFromCalcType("percentual_convenio")).toBe("valor");
  });
  it("exclusao → valor (compara R$ zero)", () => {
    expect(deriveTipoAnaliseFromCalcType("exclusao")).toBe("valor");
  });
  it("valor_fixo → quantidade", () => {
    expect(deriveTipoAnaliseFromCalcType("valor_fixo")).toBe("quantidade");
  });
  it("pacote → quantidade", () => {
    expect(deriveTipoAnaliseFromCalcType("pacote")).toBe("quantidade");
  });
  it("tabela_diferenciada → quantidade", () => {
    expect(deriveTipoAnaliseFromCalcType("tabela_diferenciada")).toBe("quantidade");
  });
  it("tabela_referencia → quantidade", () => {
    expect(deriveTipoAnaliseFromCalcType("tabela_referencia")).toBe("quantidade");
  });
  it("bonus → quantidade", () => {
    expect(deriveTipoAnaliseFromCalcType("bonus")).toBe("quantidade");
  });
  it("vazio/desconhecido → default quantidade (conservador)", () => {
    expect(deriveTipoAnaliseFromCalcType(null)).toBe("quantidade");
    expect(deriveTipoAnaliseFromCalcType("")).toBe("quantidade");
    expect(deriveTipoAnaliseFromCalcType("qualquer_coisa")).toBe("quantidade");
  });
  it("normaliza case e espaços", () => {
    expect(deriveTipoAnaliseFromCalcType("  PERCENTUAL_SOBRE_CONVENIO  ")).toBe("valor");
  });
});

describe("formatPrevistoSourceLabel", () => {
  it("mapeia todas as origens conhecidas", () => {
    expect(formatPrevistoSourceLabel("simulacao")).toBe("Simulação");
    expect(formatPrevistoSourceLabel("regra")).toBe("Histórico (calculado)");
    expect(formatPrevistoSourceLabel("historico")).toBe("Histórico (sem valor)");
    expect(formatPrevistoSourceLabel("bruto")).toBe("Bruto (sem previsão)");
    expect(formatPrevistoSourceLabel("sem_regra")).toBe("Sem regra");
  });
  it("desconhecido → string vazia", () => {
    expect(formatPrevistoSourceLabel(undefined)).toBe("");
    expect(formatPrevistoSourceLabel(null)).toBe("");
    expect(formatPrevistoSourceLabel("qualquer")).toBe("");
  });
});
