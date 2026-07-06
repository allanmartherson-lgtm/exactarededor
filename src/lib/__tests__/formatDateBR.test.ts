import { describe, it, expect } from "vitest";
import { formatDateBR } from "@/lib/dateUtils";

/**
 * Regressão: nenhuma tela pode aplicar shift de fuso ao exibir datas civis.
 * procedure_date, competências, valid_from/until etc. vêm do banco como
 * "YYYY-MM-DD" (puro) ou "YYYY-MM-DD HH:MM:SS+00" (legado UTC midnight).
 * Em ambos os casos o dia exibido deve ser exatamente o dia que aparece
 * nos 10 primeiros caracteres — nunca converter para America/Sao_Paulo,
 * porque isso fazia 14/05 virar 13/05 e produzir "duplicidade falsa".
 */
describe("formatDateBR — sem shift de fuso para YYYY-MM-DD", () => {
  it("data pura YYYY-MM-DD mantém o dia", () => {
    expect(formatDateBR("2026-05-14")).toBe("14/05/2026");
  });

  it("UTC midnight (legado) NÃO regride para o dia anterior em UTC-3", () => {
    expect(formatDateBR("2026-05-14 00:00:00+00")).toBe("14/05/2026");
    expect(formatDateBR("2026-05-14T00:00:00Z")).toBe("14/05/2026");
    expect(formatDateBR("2026-05-14T00:00:00+00:00")).toBe("14/05/2026");
  });

  it("primeiro dia do mês não vira último dia do mês anterior", () => {
    expect(formatDateBR("2026-01-01")).toBe("01/01/2026");
    expect(formatDateBR("2026-01-01T00:00:00Z")).toBe("01/01/2026");
  });

  it("data com hora local próxima da meia-noite mantém o dia do prefixo YMD", () => {
    // Regra do projeto: para datas civis o dia exibido é o do prefixo YMD,
    // independentemente do offset — não misturamos data civil com timestamp.
    expect(formatDateBR("2026-05-14T23:30:00-03:00")).toBe("14/05/2026");
  });

  it("null/undefined/vazio retorna traço", () => {
    expect(formatDateBR(null)).toBe("—");
    expect(formatDateBR(undefined)).toBe("—");
    expect(formatDateBR("")).toBe("—");
  });

  it("string inválida cai no fallback sem quebrar", () => {
    expect(formatDateBR("qualquer coisa")).toBe("qualquer coisa");
  });
});
