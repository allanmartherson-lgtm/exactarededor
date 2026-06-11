import { describe, it, expect } from "vitest";

/**
 * Cálculo de bruto/líquido após ciclos de acatar/undo.
 *
 * Espelha as fórmulas que vivem em:
 *  - compute-company-financials (bruto = Σ gross_amount onde !is_cancelled && !package_absorbed)
 *  - accept_payment_item RPC    (gross := expected; preserva gross_amount_original)
 *  - undo_accept_payment_item   (gross := gross_amount_original quando reason='acatado_esperado')
 *
 * Cenários cobertos:
 *  1) Múltiplos pacotes na mesma empresa: cada pacote zera secundários e o
 *     bruto é a soma dos esperados dos âncoras após acatar.
 *  2) Tabela diferenciada (percentual de repasse já calculado em expected_amount):
 *     acatar troca gross pelo esperado e o líquido cai sem perder rastro.
 *  3) Undo após acatar restaura o bruto original byte-a-byte.
 *  4) Combinação dos dois (pacotes + tabela_diferenciada na mesma empresa).
 *  5) Idempotência: acatar duas vezes não corrompe gross_amount_original.
 */

type Item = {
  id: string;
  gross_amount: number;
  expected_amount: number | null;
  is_cancelled?: boolean;
  package_absorbed?: boolean;
  gross_amount_original?: number | null;
  gross_override_at?: string | null;
  gross_override_reason?: string | null;
  applied_calc_method?: string;
};

type Composition = {
  bruto: number;
  debitos: number;
  creditos: number;
  glosas: number;
  liquido: number;
};

function bruto(items: Item[]): number {
  return Number(
    items
      .filter((it) => !it.is_cancelled && !it.package_absorbed)
      .reduce((s, it) => s + Number(it.gross_amount || 0), 0)
      .toFixed(2),
  );
}

function composicao(items: Item[], opts: { debitos?: number; creditos?: number; glosas?: number } = {}): Composition {
  const b = bruto(items);
  const debitos = opts.debitos ?? 0;
  const creditos = opts.creditos ?? 0;
  const glosas = opts.glosas ?? 0;
  return {
    bruto: b,
    debitos,
    creditos,
    glosas,
    liquido: Number((b - debitos + creditos - glosas).toFixed(2)),
  };
}

/** Replica accept_payment_item: copia expected→gross, preserva original 1x. */
function aceitar(item: Item): Item {
  if (item.expected_amount == null) return item;
  const alreadyOverridden = item.gross_override_at != null;
  return {
    ...item,
    gross_amount: item.expected_amount,
    gross_amount_original: alreadyOverridden ? item.gross_amount_original : item.gross_amount,
    gross_override_at: new Date().toISOString(),
    gross_override_reason: "acatado_esperado",
  };
}

/** Replica undo_accept_payment_item: restaura quando reason='acatado_esperado'. */
function desfazer(item: Item): Item {
  if (item.gross_override_reason !== "acatado_esperado") return item;
  return {
    ...item,
    gross_amount: item.gross_amount_original ?? item.gross_amount,
    gross_amount_original: null,
    gross_override_at: null,
    gross_override_reason: null,
  };
}

// ---------------------------------------------------------------------------

describe("financeiro · acatar/undo com múltiplos pacotes", () => {
  // Empresa com 2 pacotes (cirurgia A com 2 secundários, cirurgia B com 1 secundário)
  // + um item solto de tabela_diferenciada.
  const base = (): Item[] => [
    // Pacote A
    { id: "A-anchor", gross_amount: 22000, expected_amount: 19547.95, applied_calc_method: "pacote" },
    { id: "A-sec1", gross_amount: 2500, expected_amount: 0, package_absorbed: true, applied_calc_method: "pacote" },
    { id: "A-sec2", gross_amount: 1820.96, expected_amount: 0, package_absorbed: true, applied_calc_method: "pacote" },
    // Pacote B
    { id: "B-anchor", gross_amount: 8000, expected_amount: 6500, applied_calc_method: "pacote" },
    { id: "B-sec1", gross_amount: 500, expected_amount: 0, package_absorbed: true, applied_calc_method: "pacote" },
    // Item de tabela diferenciada (repasse calculado pelo motor)
    { id: "TD-1", gross_amount: 1200, expected_amount: 960, applied_calc_method: "tabela_diferenciada" },
  ];

  it("bruto exclui secundários absorvidos do pacote", () => {
    const items = base();
    // Soma só dos não-absorvidos: 22000 + 8000 + 1200 = 31200
    expect(bruto(items)).toBe(31200);
  });

  it("acatar pacote A: bruto cai exatamente o delta do esperado vs gross do âncora", () => {
    let items = base();
    const brutoAntes = bruto(items);
    const idx = items.findIndex((i) => i.id === "A-anchor");
    items[idx] = aceitar(items[idx]);
    // Bruto = 19547.95 + 8000 + 1200 = 28747.95
    expect(bruto(items)).toBe(28747.95);
    // Delta == diferença esperada
    expect(Number((brutoAntes - bruto(items)).toFixed(2))).toBe(2452.05);
    // Trilha preservada
    expect(items[idx].gross_amount_original).toBe(22000);
    expect(items[idx].gross_override_reason).toBe("acatado_esperado");
  });

  it("acatar os dois pacotes + tabela diferenciada na mesma empresa", () => {
    let items = base();
    items = items.map((it) => (["A-anchor", "B-anchor", "TD-1"].includes(it.id) ? aceitar(it) : it));
    // 19547.95 + 6500 + 960 = 27007.95
    expect(bruto(items)).toBe(27007.95);
  });

  it("undo restaura bruto byte-a-byte após acatar tudo", () => {
    let items = base();
    const brutoOriginal = bruto(items);
    items = items.map((it) => (["A-anchor", "B-anchor", "TD-1"].includes(it.id) ? aceitar(it) : it));
    expect(bruto(items)).not.toBe(brutoOriginal);
    items = items.map((it) => desfazer(it));
    expect(bruto(items)).toBe(brutoOriginal);
    // Flags limpas
    for (const it of items) {
      expect(it.gross_override_at ?? null).toBeNull();
      expect(it.gross_amount_original ?? null).toBeNull();
      expect(it.gross_override_reason ?? null).toBeNull();
    }
  });

  it("acatar duas vezes não corrompe gross_amount_original (idempotência)", () => {
    let items = base();
    const idx = items.findIndex((i) => i.id === "TD-1");
    items[idx] = aceitar(items[idx]);
    const originalApos1 = items[idx].gross_amount_original;
    items[idx] = aceitar(items[idx]);
    expect(items[idx].gross_amount_original).toBe(originalApos1);
    expect(items[idx].gross_amount_original).toBe(1200);
    expect(items[idx].gross_amount).toBe(960);
  });

  it("undo individual: desfazer só do pacote A não mexe no pacote B nem na TD", () => {
    let items = base();
    items = items.map((it) => (["A-anchor", "B-anchor", "TD-1"].includes(it.id) ? aceitar(it) : it));
    const a = items.findIndex((i) => i.id === "A-anchor");
    items[a] = desfazer(items[a]);
    // A volta a 22000; B fica em 6500; TD fica em 960; secundários zerados
    // 22000 + 6500 + 960 = 29460
    expect(bruto(items)).toBe(29460);
    expect(items.find((i) => i.id === "B-anchor")!.gross_amount).toBe(6500);
    expect(items.find((i) => i.id === "TD-1")!.gross_amount).toBe(960);
  });
});

describe("financeiro · líquido reflete acate/undo com débitos e glosas", () => {
  it("líquido = bruto − débitos + créditos − glosas, recomputado após acatar", () => {
    const items: Item[] = [
      { id: "x", gross_amount: 10000, expected_amount: 7500, applied_calc_method: "percentual_convenio" },
    ];
    const antes = composicao(items, { debitos: 500, glosas: 200 });
    expect(antes).toEqual({ bruto: 10000, debitos: 500, creditos: 0, glosas: 200, liquido: 9300 });
    const items2 = [aceitar(items[0])];
    const depois = composicao(items2, { debitos: 500, glosas: 200 });
    expect(depois).toEqual({ bruto: 7500, debitos: 500, creditos: 0, glosas: 200, liquido: 6800 });
    // Delta do líquido == delta do bruto (débitos/glosas inalterados)
    expect(antes.liquido - depois.liquido).toBe(antes.bruto - depois.bruto);
  });

  it("undo restaura líquido ao valor original", () => {
    const items: Item[] = [
      { id: "x", gross_amount: 10000, expected_amount: 7500, applied_calc_method: "percentual_convenio" },
    ];
    const original = composicao(items, { debitos: 500, glosas: 200 });
    const aceito = [aceitar(items[0])];
    const restaurado = [desfazer(aceito[0])];
    expect(composicao(restaurado, { debitos: 500, glosas: 200 })).toEqual(original);
  });

  it("expected_amount ausente: acatar é no-op (não corrompe gross)", () => {
    const item: Item = { id: "no-rule", gross_amount: 1500, expected_amount: null };
    const after = aceitar(item);
    expect(after.gross_amount).toBe(1500);
    expect(after.gross_override_reason ?? null).toBeNull();
  });

  it("item cancelado não entra no bruto mesmo após acatar", () => {
    const items: Item[] = [
      { id: "ok", gross_amount: 1000, expected_amount: 800 },
      { id: "cancel", gross_amount: 999, expected_amount: 999, is_cancelled: true },
    ];
    expect(bruto(items)).toBe(1000);
    const aceitos = items.map(aceitar);
    expect(bruto(aceitos)).toBe(800);
  });
});
