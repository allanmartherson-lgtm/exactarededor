import { describe, it, expect, vi } from "vitest";
import { learnCompanyAlias, shouldLearnAlias } from "../learnCompanyAlias";

/**
 * Mock mínimo do cliente Supabase para testar o helper sem rede.
 * Replica apenas as superfícies usadas: rpc() e from().select().eq().maybeSingle().
 */
function makeClient(opts: {
  rpcError?: { message: string } | null;
  selectAliases?: string[];
  selectError?: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: opts.rpcError ?? null });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({
      data: opts.selectAliases !== undefined ? { aliases: opts.selectAliases } : null,
      error: opts.selectError ?? null,
    });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { rpc, from, select, eq, maybeSingle } as const;
}

describe("learnCompanyAlias", () => {
  it("chama a RPC com os parâmetros normalizados e retorna o array atualizado", async () => {
    const c = makeClient({ selectAliases: ["MARIA D'AJUDA", "MD STAR"] });

    const res = await learnCompanyAlias(c as never, {
      companyId: "11111111-1111-1111-1111-111111111111",
      rawName: "  MD STAR  ",
    });

    expect(c.rpc).toHaveBeenCalledWith("learn_company_alias", {
      _company_id: "11111111-1111-1111-1111-111111111111",
      _raw_name: "MD STAR", // trim aplicado
    });
    expect(c.from).toHaveBeenCalledWith("companies");
    expect(c.select).toHaveBeenCalledWith("aliases");
    expect(c.eq).toHaveBeenCalledWith("id", "11111111-1111-1111-1111-111111111111");
    expect(res).toEqual({ ok: true, aliases: ["MARIA D'AJUDA", "MD STAR"], error: null });
  });

  it("ignora chamadas com rawName vazio (não invoca RPC)", async () => {
    const c = makeClient({ selectAliases: [] });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "   " });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, aliases: [], error: "raw_name vazio" });
  });

  it("propaga erro da RPC sem fazer SELECT subsequente", async () => {
    const c = makeClient({ rpcError: { message: "permission denied" } });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(c.rpc).toHaveBeenCalledOnce();
    expect(c.from).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, aliases: [], error: "permission denied" });
  });

  it("propaga erro do SELECT de recarga", async () => {
    const c = makeClient({ selectError: { message: "boom" } });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(res).toEqual({ ok: false, aliases: [], error: "boom" });
  });

  it("retorna array vazio quando a empresa não tem aliases ainda", async () => {
    const c = makeClient({ selectAliases: undefined });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(res).toEqual({ ok: true, aliases: [], error: null });
  });

  // ---------- Regressão: falha do SELECT pós-RPC ----------
  // Quando a RPC grava com sucesso mas o SELECT de recarga falha (ex.: queda
  // de rede, RLS rara), o helper PRECISA devolver ok:false e NÃO pode entregar
  // um array de aliases (mesmo do estado anterior) — caso contrário o caller
  // mostraria toast verde + atualizaria a UI como se o apelido estivesse
  // garantido, escondendo a inconsistência. O contrato é: aliases=[] + error
  // preenchido + ok=false, forçando o caller a NÃO mexer no cache local.
  it("após falha do SELECT, não vaza aliases nem indica sucesso", async () => {
    const c = makeClient({ selectError: { message: "network error" } });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(c.rpc).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    expect(res.aliases).toEqual([]);
    expect(res.error).toBe("network error");
  });

  // ---------- Normalização do rawName ----------
  it("preserva o casing original do apelido (apenas trim, sem lowercasing)", async () => {
    const c = makeClient({ selectAliases: ["Chain Villar LTDA"] });
    const res = await learnCompanyAlias(c as never, {
      companyId: "x",
      rawName: "\t  Chain Villar LTDA  \n",
    });
    expect(c.rpc).toHaveBeenCalledWith("learn_company_alias", {
      _company_id: "x",
      _raw_name: "Chain Villar LTDA", // casing intacto, whitespace removido
    });
    expect(res).toEqual({ ok: true, aliases: ["Chain Villar LTDA"], error: null });
  });

  it.each([
    ["string vazia", ""],
    ["apenas espaços", "     "],
    ["tabs e quebras de linha", "\t\n  \t"],
  ])("não dispara RPC quando rawName é %s", async (_label, rawName) => {
    const c = makeClient({ selectAliases: ["nao-deveria-aparecer"] });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(c.from).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, aliases: [], error: "raw_name vazio" });
  });
});

/**
 * shouldLearnAlias é a regra compartilhada entre "troca manual" e
 * "confirmação de sugestão" no /pagamentos/novo. Garante que MESMO quando
 * o match automático é considerado bom (analista só confirma), o sistema
 * ainda dispara o aprendizado se o rawCompanyName do arquivo não estiver
 * cadastrado como nome ou alias da empresa escolhida.
 */
describe("shouldLearnAlias", () => {
  it("retorna true quando o rawName não é o nome nem alias da empresa (confirmação ainda aprende)", () => {
    expect(
      shouldLearnAlias("CHAIN VILLAR LTDA - CC", {
        name: "Chain Villar LTDA",
        aliases: ["Chain Villar"],
      }),
    ).toBe(true);
  });

  it("retorna false quando o rawName == name (case/whitespace insensitive)", () => {
    expect(
      shouldLearnAlias("  chain villar ltda  ", {
        name: "Chain Villar LTDA",
        aliases: [],
      }),
    ).toBe(false);
  });

  it("retorna false quando o rawName já está em aliases (case-insensitive)", () => {
    expect(
      shouldLearnAlias("OTOEX", {
        name: "BSB Otorrino LTDA",
        aliases: ["otoex", "BSB Otorrino"],
      }),
    ).toBe(false);
  });

  it("retorna false para rawName vazio/whitespace mesmo com empresa válida", () => {
    const company = { name: "Acme", aliases: [] };
    expect(shouldLearnAlias("", company)).toBe(false);
    expect(shouldLearnAlias("   \t\n", company)).toBe(false);
    expect(shouldLearnAlias(null, company)).toBe(false);
    expect(shouldLearnAlias(undefined, company)).toBe(false);
  });

  it("retorna false quando company é null/undefined", () => {
    expect(shouldLearnAlias("Acme", null)).toBe(false);
    expect(shouldLearnAlias("Acme", undefined)).toBe(false);
  });

  it("tolera aliases nulos/undefined/com entradas vazias", () => {
    expect(
      shouldLearnAlias("NovoApelido", {
        name: "Empresa X",
        aliases: null as unknown as string[],
      }),
    ).toBe(true);
    expect(
      shouldLearnAlias("NovoApelido", {
        name: "Empresa X",
        aliases: ["", "  ", "outro"],
      }),
    ).toBe(true);
  });
});
