import { describe, it, expect, vi } from "vitest";
import { learnCompanyAlias } from "../learnCompanyAlias";

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
    expect(res).toEqual({ ok: true, aliases: ["MARIA D'AJUDA", "MD STAR"] });
  });

  it("ignora chamadas com rawName vazio (não invoca RPC)", async () => {
    const c = makeClient({ selectAliases: [] });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "   " });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: "raw_name vazio" });
  });

  it("propaga erro da RPC sem fazer SELECT subsequente", async () => {
    const c = makeClient({ rpcError: { message: "permission denied" } });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(c.rpc).toHaveBeenCalledOnce();
    expect(c.from).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: "permission denied" });
  });

  it("propaga erro do SELECT de recarga", async () => {
    const c = makeClient({ selectError: { message: "boom" } });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("retorna array vazio quando a empresa não tem aliases ainda", async () => {
    const c = makeClient({ selectAliases: undefined });
    const res = await learnCompanyAlias(c as never, { companyId: "x", rawName: "Acme" });
    expect(res).toEqual({ ok: true, aliases: [] });
  });
});
