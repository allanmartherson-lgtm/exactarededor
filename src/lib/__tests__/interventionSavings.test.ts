import { describe, it, expect } from "vitest";
import {
  filterItems,
  impactTone,
  itemsToCsv,
  summarizeItems,
  type InterventionItem,
} from "@/lib/interventionSavings";

const item = (over: Partial<InterventionItem>): InterventionItem => ({
  item_id: "i1",
  payment_id: "p1",
  obs_id: "o1",
  valor_regra: 1000,
  valor_pago_final: 800,
  delta: 200,
  author_id: "u1",
  autor: "Dra. Diretora",
  role: "diretor",
  obs_at: "2026-06-01T10:00:00Z",
  acatado_at: "2026-06-02T10:00:00Z",
  doctor_name: "Dr. House",
  procedure_code: "12345678",
  procedure_name: "Endoscopia",
  company_name: "Clínica X",
  company_group_id: null,
  ...over,
});

describe("summarizeItems", () => {
  it("separa economia e perda; saldo é a soma assinada", () => {
    const items = [
      item({ delta: 200 }),
      item({ delta: 50 }),
      item({ delta: -120 }),
    ];
    const s = summarizeItems(items);
    expect(s.economia).toBeCloseTo(250);
    expect(s.perda).toBeCloseTo(120);
    expect(s.saldo).toBeCloseTo(130);
    expect(s.qtd_itens).toBe(3);
  });

  it("delta zero não afeta nenhum acumulador", () => {
    const s = summarizeItems([item({ delta: 0 })]);
    expect(s).toEqual({ economia: 0, perda: 0, saldo: 0, qtd_itens: 1 });
  });

  it("lista vazia → tudo zero", () => {
    expect(summarizeItems([])).toEqual({
      economia: 0,
      perda: 0,
      saldo: 0,
      qtd_itens: 0,
    });
  });
});

describe("filterItems", () => {
  const items = [
    item({ item_id: "a", role: "diretor", author_id: "u1", doctor_name: "House" }),
    item({ item_id: "b", role: "validador", author_id: "u2", doctor_name: "Wilson" }),
    item({ item_id: "c", role: "diretor", author_id: "u1", company_name: "Acme" }),
  ];

  it("filtra por role", () => {
    expect(filterItems(items, { role: "validador" }).map((i) => i.item_id)).toEqual(["b"]);
  });

  it("filtra por usuário", () => {
    expect(filterItems(items, { userId: "u2" }).map((i) => i.item_id)).toEqual(["b"]);
  });

  it("busca textual cobre autor/médico/procedimento/empresa (case-insensitive)", () => {
    expect(filterItems(items, { search: "acme" }).map((i) => i.item_id)).toEqual(["c"]);
    expect(filterItems(items, { search: "WILSON" }).map((i) => i.item_id)).toEqual(["b"]);
  });

  it("'all' equivale a sem filtro", () => {
    expect(filterItems(items, { role: "all", userId: "all" })).toHaveLength(3);
  });
});

describe("impactTone", () => {
  it.each([
    [1000, "positive"],
    [-1000, "negative"],
    [0, "neutral"],
    [0.001, "neutral"],
  ] as const)("saldo %s → %s", (saldo, tone) => {
    expect(impactTone(saldo)).toBe(tone);
  });
});

describe("itemsToCsv", () => {
  it("inclui header e formato BR para valores numéricos", () => {
    const csv = itemsToCsv([item({ delta: 200, valor_regra: 1000, valor_pago_final: 800 })]);
    const [head, row] = csv.split("\n");
    expect(head.split(";")).toContain("delta");
    expect(row).toContain("1000,00");
    expect(row).toContain("800,00");
    expect(row).toContain("200,00");
  });

  it("escapa aspas em campos textuais", () => {
    const csv = itemsToCsv([item({ doctor_name: 'Dr. "Aspas" House' })]);
    expect(csv).toContain('"Dr. ""Aspas"" House"');
  });
});
