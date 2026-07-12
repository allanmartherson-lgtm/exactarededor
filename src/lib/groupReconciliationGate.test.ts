import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { evaluateGroupReconciliationGate } from "./groupReconciliationGate";
import type { GroupItemForTotals } from "./groupRuleTotals";

const item = (o: Partial<GroupItemForTotals>): GroupItemForTotals => ({
  gross_amount: 0,
  expected_amount: 0,
  applied_calc_id: "calc-x",
  package_absorbed: false,
  ...o,
});

// Limiares padrão parecidos com hospital piloto (DF Star): 0.5% ou R$ 100
const THRESH = { blockPct: 0.5, blockAbs: 100 };

describe("evaluateGroupReconciliationGate — bruto ajustado", () => {
  it("SALUTAIRE: pacote absorvido NÃO deve bloquear (regressão 12/07/2026)", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 65432.61,
      items: [
        item({ gross_amount: 4367.32, expected_amount: 4367.32 }),
        item({ gross_amount: 4367.32, expected_amount: 0, package_absorbed: true }),
        item({ gross_amount: 56697.97, expected_amount: 56697.97 }),
      ],
      ...THRESH,
    });
    expect(r.absorbido).toBeCloseTo(4367.32, 2);
    expect(r.brutoPedidoAjustado).toBeCloseTo(61065.29, 2);
    expect(Math.abs(r.diferenca)).toBeLessThan(0.01);
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("ok_within_tolerance");
  });

  it("GMG: pacote com âncora + absorvido idêntico não bloqueia", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 21834.38,
      items: [
        item({ gross_amount: 9718.72, expected_amount: 9718.72 }),
        item({ gross_amount: 9718.72, expected_amount: 0, package_absorbed: true }),
        item({ gross_amount: 2396.94, expected_amount: 2396.94 }),
      ],
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
  });

  it("dentro da tolerância percentual: não bloqueia", () => {
    // diferença de R$ 200 em R$ 100k = 0,2% → dentro de 0,5%
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 100_000,
      items: [item({ gross_amount: 100_000, expected_amount: 99_800 })],
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("ok_within_tolerance");
  });

  it("dentro da tolerância absoluta: não bloqueia", () => {
    // diferença de R$ 90 em R$ 5k = 1,8% (acima do %), mas <= R$ 100 → passa
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 5_000,
      items: [item({ gross_amount: 5_000, expected_amount: 4_910 })],
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
  });

  it("fora da tolerância (sem override): bloqueia", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 50_000,
      items: [item({ gross_amount: 50_000, expected_amount: 48_000 })],
      ...THRESH,
    });
    // diff R$ 2000 (4%) — supera 0,5% e R$ 100
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("blocked_diff");
    expect(r.diferenca).toBeCloseTo(2000, 2);
  });

  it("fora da tolerância COM override: não bloqueia", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 50_000,
      items: [item({ gross_amount: 50_000, expected_amount: 48_000 })],
      hasOverride: true,
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("ok_override");
  });

  it("import_mode='historico': nunca bloqueia mesmo com diff enorme", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 100_000,
      items: [item({ gross_amount: 100_000, expected_amount: 0 })],
      importMode: "historico",
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("ok_historico");
  });

  it("gate USA bruto ajustado — pacote grande não vira bloqueio fantasma", () => {
    // Simula bug antigo: se o gate usasse bruto_pedido cru, diff seria 4367.32
    // (> R$ 100 e ~6,7%) e travaria envio. Com bruto ajustado, diff = 0.
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 65432.61,
      items: [
        item({ gross_amount: 4367.32, expected_amount: 4367.32 }),
        item({ gross_amount: 4367.32, expected_amount: 0, package_absorbed: true }),
        item({ gross_amount: 56697.97, expected_amount: 56697.97 }),
      ],
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
    // Sanity: se usarmos o pedido cru, veríamos ~4367 de diff — asseguramos que NÃO é isso
    const diffContraCru = 65432.61 - r.brutoRegra;
    expect(Math.abs(diffContraCru)).toBeGreaterThan(4000);
    // Enquanto a diferença efetiva do gate é ~0
    expect(Math.abs(r.diferenca)).toBeLessThan(0.01);
  });

  it("grupo vazio não bloqueia", () => {
    const r = evaluateGroupReconciliationGate({
      brutoPedidoTotal: 0,
      items: [],
      ...THRESH,
    });
    expect(r.blocked).toBe(false);
    expect(r.diffPct).toBe(0);
  });
});

/**
 * Snapshot da migração: garante que a trigger continue lendo `absorbido_total`
 * da view e calculando `bruto_pedido_ajustado = pedido - absorbido` antes de
 * comparar com o threshold. Se alguém reescrever a função sem isso, o teste
 * falha e força revisão.
 */
describe("check_group_reconciliation_gate migration snapshot", () => {
  it("a migração mais recente do gate desconta absorbido_total", () => {
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const gateFiles = files.filter((f) => {
      const sql = readFileSync(path.join(dir, f), "utf8");
      return /FUNCTION\s+public\.check_group_reconciliation_gate/i.test(sql);
    });
    expect(gateFiles.length).toBeGreaterThan(0);
    const latest = gateFiles[gateFiles.length - 1];
    const sql = readFileSync(path.join(dir, latest), "utf8");

    // Precisa selecionar absorbido_total da view
    expect(sql).toMatch(/absorbido_total/i);
    // E computar bruto_pedido_ajustado = bruto_pedido - absorbido
    expect(sql).toMatch(/bruto_pedido_ajustado\s*:?=\s*v_bruto_pedido\s*-\s*v_absorbido/i);
    // E usar bruto_pedido_ajustado no cálculo de diff_pct
    expect(sql).toMatch(/v_diferenca\s*\/\s*v_bruto_pedido_ajustado/i);
  });
});
