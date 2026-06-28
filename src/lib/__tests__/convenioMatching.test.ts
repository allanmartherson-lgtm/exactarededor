import { describe, it, expect } from "vitest";
import {
  normalizeConvenioSlugs,
  hasConvenioSlug,
  toggleConvenioSlug,
  rubricMatchesConvenio,
} from "../convenioMatching";

describe("normalizeConvenioSlugs", () => {
  it("remove duplicados, vazios e normaliza case/trim", () => {
    expect(normalizeConvenioSlugs(["Bradesco", "bradesco", "  BRADESCO  ", "", null, undefined, "sulamerica"]))
      .toEqual(["bradesco", "sulamerica"]);
  });
  it("retorna [] para null/undefined", () => {
    expect(normalizeConvenioSlugs(null)).toEqual([]);
    expect(normalizeConvenioSlugs(undefined)).toEqual([]);
    expect(normalizeConvenioSlugs([])).toEqual([]);
  });
});

describe("toggleConvenioSlug", () => {
  it("adiciona quando ausente", () => {
    expect(toggleConvenioSlug(["bradesco"], "amil")).toEqual(["bradesco", "amil"]);
  });
  it("remove quando presente (case-insensitive)", () => {
    expect(toggleConvenioSlug(["bradesco", "amil"], "AMIL")).toEqual(["bradesco"]);
  });
  it("nunca produz duplicado mesmo se entrada vier suja", () => {
    expect(toggleConvenioSlug(["bradesco", "bradesco", "AMIL"], "unimed"))
      .toEqual(["bradesco", "amil", "unimed"]);
  });
  it("ignora candidato vazio mas ainda normaliza a lista", () => {
    expect(toggleConvenioSlug(["BRADESCO", "bradesco"], "  ")).toEqual(["bradesco"]);
  });
});

describe("hasConvenioSlug", () => {
  it("compara case-insensitive", () => {
    expect(hasConvenioSlug(["bradesco"], "BRADESCO")).toBe(true);
    expect(hasConvenioSlug(["bradesco"], "amil")).toBe(false);
    expect(hasConvenioSlug([], "bradesco")).toBe(false);
  });
});

describe("rubricMatchesConvenio (vazio = qualquer)", () => {
  it("lista vazia casa com qualquer convênio", () => {
    expect(rubricMatchesConvenio([], "bradesco")).toBe(true);
    expect(rubricMatchesConvenio(null, "amil")).toBe(true);
    expect(rubricMatchesConvenio(undefined, null)).toBe(true);
    expect(rubricMatchesConvenio([], null)).toBe(true);
  });

  it("lista preenchida casa apenas com slugs presentes", () => {
    expect(rubricMatchesConvenio(["bradesco", "amil"], "amil")).toBe(true);
    expect(rubricMatchesConvenio(["bradesco"], "AMIL")).toBe(false);
  });

  it("rubrica restrita nunca casa com item sem convênio", () => {
    expect(rubricMatchesConvenio(["bradesco"], null)).toBe(false);
    expect(rubricMatchesConvenio(["bradesco"], "")).toBe(false);
  });

  it("normaliza case do item recebido", () => {
    expect(rubricMatchesConvenio(["bradesco"], "  Bradesco ")).toBe(true);
  });

  it("entradas sujas na rubrica não criam falsos positivos/negativos", () => {
    expect(rubricMatchesConvenio(["", "BRADESCO", "bradesco"], "bradesco")).toBe(true);
    expect(rubricMatchesConvenio(["", "  "], "bradesco")).toBe(true); // tudo vazio = qualquer
  });
});
