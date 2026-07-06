import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadDraft, saveDraft, clearDraft, isDraftMeaningful, fileKey } from "./newPaymentDraft";

// Mock local de localStorage (jsdom não garante um por padrão em todos os setups)
beforeEach(() => {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  vi.stubGlobal("localStorage", mock);
});

describe("newPaymentDraft · round-trip salvar/carregar", () => {
  it("o que é salvo volta idêntico ao carregar com a mesma chave", () => {
    saveDraft("h1", "padrao", "t1", { form: { reference: "LOTE-001", competenceMonths: ["2026-01-01"] } });
    const r = loadDraft("h1", "padrao", "t1");
    expect(r).not.toBeNull();
    expect(r!.form.reference).toBe("LOTE-001");
    expect(r!.form.competenceMonths).toEqual(["2026-01-01"]);
    expect(r!.v).toBe(1);
    expect(typeof r!.savedAt).toBe("number");
  });

  it("rascunho de um hospital não aparece em outro (isolamento por chave)", () => {
    saveDraft("h1", "padrao", "t1", { form: { reference: "DO-H1" } });
    expect(loadDraft("h2", "padrao", "t1")).toBeNull();
    expect(loadDraft("h1", "confeccao", "t1")).toBeNull();
    expect(loadDraft("h1", "padrao", "t2")).toBeNull();
  });

  it("clearDraft remove o rascunho", () => {
    saveDraft("h1", "padrao", "t1", { form: { reference: "X" } });
    clearDraft("h1", "padrao", "t1");
    expect(loadDraft("h1", "padrao", "t1")).toBeNull();
  });

  it("chaves com hospital/tipo nulos usam placeholder e funcionam", () => {
    saveDraft(null, "padrao", null, { form: { reference: "SEM-HOSP" } });
    expect(loadDraft(null, "padrao", null)!.form.reference).toBe("SEM-HOSP");
  });
});

describe("newPaymentDraft · versão e expiração", () => {
  it("rascunho de versão diferente é descartado", () => {
    localStorage.setItem("newPaymentDraft:v1:h1:padrao:t1", JSON.stringify({ v: 99, savedAt: Date.now(), form: { reference: "VELHO" } }));
    expect(loadDraft("h1", "padrao", "t1")).toBeNull();
  });

  it("rascunho com mais de 7 dias é expirado e removido", () => {
    const oito_dias = Date.now() - 1000 * 60 * 60 * 24 * 8;
    localStorage.setItem("newPaymentDraft:v1:h1:padrao:t1", JSON.stringify({ v: 1, savedAt: oito_dias, form: { reference: "EXPIRADO" } }));
    expect(loadDraft("h1", "padrao", "t1")).toBeNull();
    expect(localStorage.getItem("newPaymentDraft:v1:h1:padrao:t1")).toBeNull();
  });

  it("rascunho recente (dentro do TTL) é carregado", () => {
    const ontem = Date.now() - 1000 * 60 * 60 * 24;
    localStorage.setItem("newPaymentDraft:v1:h1:padrao:t1", JSON.stringify({ v: 1, savedAt: ontem, form: { reference: "RECENTE" } }));
    expect(loadDraft("h1", "padrao", "t1")!.form.reference).toBe("RECENTE");
  });
});

describe("newPaymentDraft · tolerância a falha", () => {
  it("JSON corrompido no storage retorna null sem lançar", () => {
    localStorage.setItem("newPaymentDraft:v1:h1:padrao:t1", "{lixo corrompido");
    expect(() => loadDraft("h1", "padrao", "t1")).not.toThrow();
    expect(loadDraft("h1", "padrao", "t1")).toBeNull();
  });
});

describe("isDraftMeaningful", () => {
  it("null não é significativo", () => {
    expect(isDraftMeaningful(null)).toBe(false);
  });
  it("rascunho totalmente vazio não é significativo", () => {
    expect(isDraftMeaningful({ v: 1, savedAt: Date.now(), form: {} })).toBe(false);
  });
  it("só com referência preenchida já é significativo", () => {
    expect(isDraftMeaningful({ v: 1, savedAt: Date.now(), form: { reference: "X" } })).toBe(true);
  });
  it("só com arquivos anexados é significativo", () => {
    expect(isDraftMeaningful({ v: 1, savedAt: Date.now(), form: {}, fileDecisions: { "a.xlsx::1::2": {} } })).toBe(true);
  });
  it("só com decisões suspeitas é significativo", () => {
    expect(isDraftMeaningful({ v: 1, savedAt: Date.now(), form: {}, suspiciousDecisions: { x: 1 } })).toBe(true);
  });
});

describe("fileKey", () => {
  it("monta nome::tamanho::lastModified", () => {
    expect(fileKey({ name: "base.xlsx", size: 1024, lastModified: 999 })).toBe("base.xlsx::1024::999");
  });
});
