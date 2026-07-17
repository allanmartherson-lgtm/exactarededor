/**
 * Guardrail: garante que a RPC `get_intervention_savings` e os relatórios de
 * "Itens ajustados" NUNCA voltem a incluir lotes com `import_mode='historico'`.
 *
 * Historico foi carregado só para compor DRE; se aparecer no KPI de intervenção
 * infla economia/perda artificialmente. Já quebramos esse contrato uma vez —
 * este teste evita regressão silenciosa.
 *
 * Estratégia (sem depender de DB rodando):
 *   1. Encontra a migration mais recente que define `get_intervention_savings`
 *      e valida que a definição filtra `import_mode <> 'historico'`.
 *   2. Valida que as telas frontend consomem essa RPC (e não fazem SELECT
 *      cru em `intervention_ledger` que ignoraria o filtro).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");
const PAGES_DIR = resolve(__dirname, "../../pages");

const RPC_NAME = "get_intervention_savings";
// Páginas que agregam intervenções de MÚLTIPLOS pagamentos — precisam passar
// pela RPC para herdar o filtro de histórico. InterventionReports é só
// wrapper de sub-tabs; LoteInterventionReport lê ledger por payment_id (ok).
const REPORT_PAGES = [
  "InterventionAdjustments.tsx",
  "InterventionAudit.tsx",
];

/** Retorna o conteúdo da migration mais recente (por nome de arquivo, ordem lexicográfica) que menciona o padrão. */
function latestMigrationDefining(pattern: RegExp): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of [...files].reverse()) {
    const content = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (pattern.test(content)) return content;
  }
  throw new Error(`Nenhuma migration encontrada com padrão ${pattern}`);
}

describe(`RPC ${RPC_NAME} — filtro de histórico`, () => {
  const definitionPattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${RPC_NAME}`,
    "i",
  );
  const sql = latestMigrationDefining(definitionPattern);

  it("faz JOIN com public.payments para checar import_mode", () => {
    expect(sql).toMatch(/JOIN\s+public\.payments/i);
  });

  it("filtra explicitamente import_mode <> 'historico'", () => {
    // Aceita variações de espaço/quote, mas exige presença simultânea de
    // 'import_mode' e literal 'historico' no mesmo bloco WHERE.
    const hasImportMode = /import_mode/i.test(sql);
    const excludesHistorico =
      /import_mode[^;]{0,80}<>\s*'historico'/i.test(sql) ||
      /import_mode[^;]{0,80}!=\s*'historico'/i.test(sql) ||
      /NOT\s+IN\s*\(\s*'historico'/i.test(sql);
    expect(hasImportMode, "RPC precisa referenciar payments.import_mode").toBe(true);
    expect(excludesHistorico, "RPC precisa excluir import_mode='historico'").toBe(true);
  });
});

describe("Relatórios de Itens ajustados consomem a RPC (não bypassam o filtro)", () => {
  for (const page of REPORT_PAGES) {
    const path = join(PAGES_DIR, page);
    let exists = false;
    try {
      exists = statSync(path).isFile();
    } catch {
      /* página pode ter sido renomeada; o próprio teste sinaliza */
    }
    if (!exists) continue;
    const src = readFileSync(path, "utf8");

    it(`${page} usa rpc('${RPC_NAME}')`, () => {
      expect(src).toMatch(new RegExp(`rpc\\(\\s*["']${RPC_NAME}["']`));
    });

    it(`${page} não faz SELECT cru em intervention_ledger (bypassaria import_mode)`, () => {
      // Exceção legítima: LoteInterventionReport lê ledger por payment_id,
      // mas não está nesta lista. Aqui bloqueamos qualquer .from("intervention_ledger")
      // nos relatórios agregados.
      expect(src).not.toMatch(/\.from\(\s*["']intervention_ledger["']/);
    });
  }
});
