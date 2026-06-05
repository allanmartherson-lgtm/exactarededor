/**
 * Testes do helper parseCrm — base do reconhecimento de CRM em formato
 * unificado ("28923/DF") ou separado (número + UF).
 *
 * Cobre:
 *  - formatos válidos: barra, hífen, espaço, hífen com espaços, prefixo "CRM/UF",
 *    UF antes do número, lowercase
 *  - apenas número (UF ausente)
 *  - inválidos: vazio/null/undefined, só letras, lixo sem dígitos
 *  - resolveDoctor priorizando byCrmUf vs byCrm
 */
import { describe, it, expect } from "vitest";
import {
  parseCrm,
  resolveDoctor,
  type DoctorRegistry,
  type DoctorRegistryEntry,
} from "../registryLookup";

describe("parseCrm — formatos válidos", () => {
  it("aceita CRM com barra: '28923/DF'", () => {
    expect(parseCrm("28923/DF")).toEqual({ number: "28923", uf: "DF" });
  });

  it("aceita CRM com hífen: '28923-DF'", () => {
    expect(parseCrm("28923-DF")).toEqual({ number: "28923", uf: "DF" });
  });

  it("aceita CRM com espaço: '28923 DF'", () => {
    expect(parseCrm("28923 DF")).toEqual({ number: "28923", uf: "DF" });
  });

  it("aceita CRM com espaço ao redor do hífen: '28923 - DF'", () => {
    expect(parseCrm("28923 - DF")).toEqual({ number: "28923", uf: "DF" });
  });

  it("aceita prefixo 'CRM/DF 28923'", () => {
    expect(parseCrm("CRM/DF 28923")).toEqual({ number: "28923", uf: "DF" });
  });

  it("aceita UF antes do número: 'DF 28923'", () => {
    expect(parseCrm("DF 28923")).toEqual({ number: "28923", uf: "DF" });
  });

  it("normaliza UF lowercase: '28923/df'", () => {
    expect(parseCrm("28923/df")).toEqual({ number: "28923", uf: "DF" });
  });

  it("apara espaços extras: '  28923 / DF  '", () => {
    expect(parseCrm("  28923 / DF  ")).toEqual({ number: "28923", uf: "DF" });
  });

  it("ignora pontos no número: '28.923/DF'", () => {
    expect(parseCrm("28.923/DF")).toEqual({ number: "28923", uf: "DF" });
  });
});

describe("parseCrm — apenas número (UF ausente)", () => {
  it("'28923' retorna número sem UF", () => {
    expect(parseCrm("28923")).toEqual({ number: "28923", uf: "" });
  });

  it("'CRM 28923' (sem UF identificável)", () => {
    // "CRM" tem 3 letras, não casa com \b[A-Z]{2}\b -> uf vazia
    expect(parseCrm("CRM 28923")).toEqual({ number: "28923", uf: "" });
  });
});

describe("parseCrm — entradas inválidas / vazias", () => {
  it("string vazia retorna number e uf vazios", () => {
    expect(parseCrm("")).toEqual({ number: "", uf: "" });
  });

  it("null retorna number e uf vazios", () => {
    expect(parseCrm(null)).toEqual({ number: "", uf: "" });
  });

  it("undefined retorna number e uf vazios", () => {
    expect(parseCrm(undefined)).toEqual({ number: "", uf: "" });
  });

  it("só letras sem dígitos: 'DF/SP' — number vazio, uf capturada", () => {
    // Caso degenerado: existem 2 sequências de 2 letras; regex captura a 1ª.
    // O importante é que number = "" sinaliza inválido para o chamador.
    const r = parseCrm("DF/SP");
    expect(r.number).toBe("");
    expect(r.uf).toMatch(/^[A-Z]{2}$/);
  });

  it("lixo sem dígitos nem UF reconhecível: 'abc'", () => {
    expect(parseCrm("abc")).toEqual({ number: "", uf: "" });
  });

  it("só espaços: '   '", () => {
    expect(parseCrm("   ")).toEqual({ number: "", uf: "" });
  });
});

// ===== resolveDoctor =====

function makeRegistry(entries: DoctorRegistryEntry[]): DoctorRegistry {
  const reg: DoctorRegistry = {
    byCrm: new Map(),
    byCrmUf: new Map(),
    byCpf: new Map(),
    byAlias: new Map(),
  };
  for (const e of entries) {
    if (e.crm) {
      reg.byCrm.set(e.crm, e);
      if (e.crm_uf) reg.byCrmUf.set(`${e.crm}/${e.crm_uf.toUpperCase()}`, e);
    }
    if (e.cpf) reg.byCpf.set(e.cpf, e);
    if (e.full_name) reg.byAlias.set(e.full_name.toLowerCase(), e);
  }
  return reg;
}

describe("resolveDoctor — match por CRM unificado vs separado", () => {
  const docDF: DoctorRegistryEntry = {
    id: "d1",
    full_name: "Abner",
    crm: "28923",
    crm_uf: "DF",
    cpf: null,
  };
  const docSP: DoctorRegistryEntry = {
    id: "d2",
    full_name: "Outro Abner",
    crm: "28923",
    crm_uf: "SP",
    cpf: null,
  };

  it("input unificado '28923/DF' resolve o médico correto da DF", () => {
    const reg = makeRegistry([docDF, docSP]);
    const r = resolveDoctor({ crm: "28923/DF" }, reg);
    expect(r.matched_by).toBe("crm");
    expect(r.doctor?.id).toBe("d1");
  });

  it("input unificado '28923/SP' resolve o médico correto de SP", () => {
    const reg = makeRegistry([docDF, docSP]);
    const r = resolveDoctor({ crm: "28923/SP" }, reg);
    expect(r.matched_by).toBe("crm");
    expect(r.doctor?.id).toBe("d2");
  });

  it("input separado (crm + crm_uf) resolve por número+UF", () => {
    const reg = makeRegistry([docDF, docSP]);
    const r = resolveDoctor({ crm: "28923", crm_uf: "SP" }, reg);
    expect(r.matched_by).toBe("crm");
    expect(r.doctor?.id).toBe("d2");
  });

  it("input só número (UF ausente) cai para byCrm (qualquer médico com aquele número)", () => {
    const reg = makeRegistry([docDF]); // só DF cadastrado
    const r = resolveDoctor({ crm: "28923" }, reg);
    expect(r.matched_by).toBe("crm");
    expect(r.doctor?.id).toBe("d1");
  });

  it("CRM inexistente retorna null", () => {
    const reg = makeRegistry([docDF]);
    const r = resolveDoctor({ crm: "99999/DF" }, reg);
    expect(r.doctor).toBeNull();
    expect(r.matched_by).toBeNull();
  });
});
