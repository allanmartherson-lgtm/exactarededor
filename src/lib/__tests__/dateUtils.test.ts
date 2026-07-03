import { describe, it, expect } from "vitest";
import {
  isValidYmd,
  isValidYm,
  toYmd,
  parseYmdLocal,
  parseYmdUtc,
  addDaysYmd,
  competenceOfYmd,
} from "../dateUtils";

describe("dateUtils — competência sem shift de fuso", () => {
  it("isValidYmd aceita Y-M-D válido e rejeita inválidos", () => {
    expect(isValidYmd("2026-04-01")).toBe(true);
    expect(isValidYmd("2026-04-01T03:00:00Z")).toBe(true);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026/04/01")).toBe(false);
    expect(isValidYmd("")).toBe(false);
    expect(isValidYmd(null)).toBe(false);
  });

  it("isValidYm aceita Y-M válido", () => {
    expect(isValidYm("2026-04")).toBe(true);
    expect(isValidYm("2026-13")).toBe(false);
    expect(isValidYm("2026-04-01")).toBe(false);
  });

  it("toYmd extrai só os 10 primeiros chars quando válidos", () => {
    expect(toYmd("2026-04-01T03:00:00Z")).toBe("2026-04-01");
    expect(toYmd("2026-04-01")).toBe("2026-04-01");
    expect(toYmd("abc")).toBe(null);
    expect(toYmd(null)).toBe(null);
  });

  it("parseYmdLocal NÃO shifta o dia (bug clássico do new Date)", () => {
    const d = parseYmdLocal("2026-04-01");
    // Independentemente do fuso do runner, o dia LOCAL tem que ser 1 e o mês 4.
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(3);
    expect(d.getFullYear()).toBe(2026);
  });

  it("parseYmdUtc devolve UTC midnight exato", () => {
    const d = parseYmdUtc("2026-04-01");
    expect(d.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(d.getUTCHours()).toBe(0);
  });

  it("addDaysYmd opera direto em Y-M-D e cruza mês/ano corretamente", () => {
    expect(addDaysYmd("2026-04-01", -1)).toBe("2026-03-31");
    expect(addDaysYmd("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDaysYmd("2026-04-01", -90)).toBe("2026-01-01");
    expect(addDaysYmd("2026-04-30", 90)).toBe("2026-07-29");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("lixo", 5)).toBe(null);
  });

  it("competenceOfYmd devolve Y-M sem shift", () => {
    expect(competenceOfYmd("2026-04-01")).toBe("2026-04");
    expect(competenceOfYmd("2026-04-01T00:00:00Z")).toBe("2026-04");
    expect(competenceOfYmd(null)).toBe(null);
  });
});
