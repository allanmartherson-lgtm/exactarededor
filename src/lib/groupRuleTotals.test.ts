import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { computeGroupRuleTotals, type GroupItemForTotals } from "./groupRuleTotals";

const item = (o: Partial<GroupItemForTotals>): GroupItemForTotals => ({
  gross_amount: 0,
  expected_amount: 0,
  applied_calc_id: "calc-x",
  package_absorbed: false,
  ...o,
});

describe("computeGroupRuleTotals — invariante do pacote absorvido", () => {
  it("caso simples sem pacote: diferença = pedido - expected", () => {
    const t = computeGroupRuleTotals(1000, [
      item({ gross_amount: 600, expected_amount: 600 }),
      item({ gross_amount: 400, expected_amount: 400 }),
    ]);
    expect(t.absorbido_total).toBe(0);
    expect(t.bruto_regra_total).toBe(1000);
    expect(t.diferenca).toBe(0);
  });

  it("cenário SALUTAIRE — absorvidos NÃO podem gerar diferença fantasma", () => {
    // Âncora carrega o valor total do pacote no expected; absorvido mantém gross
    // reportado pelo hospital mas expected = 0.
    const totals = computeGroupRuleTotals(65432.61, [
      // âncora
      item({ gross_amount: 4367.32, expected_amount: 4367.32 }),
      // absorvidos com mesmo gross e expected zerado
      item({ gross_amount: 4367.32, expected_amount: 0, package_absorbed: true }),
      // demais itens (não-pacote) somando o restante
      item({ gross_amount: 56697.97, expected_amount: 56697.97 }),
    ]);
    expect(totals.absorbido_total).toBeCloseTo(4367.32, 2);
    expect(totals.bruto_regra_total).toBeCloseTo(61065.29, 2);
    // diferenca deve ser ~zero, NÃO 4367.32
    expect(Math.abs(totals.diferenca)).toBeLessThan(0.01);
  });

  it("cenário GMG — pacote com âncora e um absorvido idênticos", () => {
    const totals = computeGroupRuleTotals(21834.38, [
      item({ gross_amount: 9718.72, expected_amount: 9718.72 }),
      item({ gross_amount: 9718.72, expected_amount: 0, package_absorbed: true }),
      item({ gross_amount: 2396.94, expected_amount: 2396.94 }),
    ]);
    expect(totals.absorbido_total).toBeCloseTo(9718.72, 2);
    expect(Math.abs(totals.diferenca)).toBeLessThan(0.01);
  });

  it("absorvidos são ignorados em itens_sem_regra e itens_divergentes", () => {
    const totals = computeGroupRuleTotals(1000, [
      // absorvido sem regra e com "divergência" — deve ser ignorado nos dois
      item({
        gross_amount: 500,
        expected_amount: 0,
        applied_calc_id: null,
        package_absorbed: true,
      }),
      // item normal divergente (gross ≠ expected)
      item({ gross_amount: 500, expected_amount: 480 }),
    ]);
    expect(totals.itens_sem_regra).toBe(0);
    expect(totals.itens_divergentes).toBe(1);
  });

  it("grupo vazio devolve diferenca_pct null", () => {
    const t = computeGroupRuleTotals(0, []);
    expect(t.diferenca_pct).toBeNull();
    expect(t.diferenca).toBe(0);
  });
});

/**
 * Snapshot de invariante contra a MIGRATION SQL: se alguém reescrever a view
 * removendo o filtro por package_absorbed, este teste falha e força revisão.
 */
describe("vw_group_rule_totals migration snapshot", () => {
  it("a migração mais recente da view desconta itens package_absorbed", () => {
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const viewFiles = files.filter((f) => {
      const sql = readFileSync(path.join(dir, f), "utf8");
      return /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+public\.vw_group_rule_totals/i.test(sql);
    });
    expect(viewFiles.length).toBeGreaterThan(0);
    const latest = viewFiles[viewFiles.length - 1];
    const sql = readFileSync(path.join(dir, latest), "utf8");

    // Precisa referenciar package_absorbed pelo menos no cálculo do bruto_pedido
    expect(sql).toMatch(/package_absorbed/i);
    // E o cálculo de diferença precisa subtrair a soma dos absorvidos
    expect(sql).toMatch(
      /-\s*COALESCE\(SUM\(CASE WHEN pi\.package_absorbed THEN pi\.gross_amount ELSE 0 END\),\s*0\)/i,
    );
  });
});
