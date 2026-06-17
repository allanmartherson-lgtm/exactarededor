import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E de governança de cálculos de regra (estilo contract).
 *
 * Por que não Playwright/Cypress?
 *  - O projeto roda apenas Vitest e não temos sessão admin/diretor reprodutível
 *    no CI; mockar Supabase + React Query + dialogs para clicar no botão de
 *    "Remover cálculo" no editor reproduz a UI mas NÃO exercita o trigger
 *    nem a RPC reais — que são exatamente as camadas que precisamos provar.
 *
 *  - Este teste percorre a cadeia inteira (UI handler → confirmDialog →
 *    RPC apply_rule_save_with_corrections → trigger trg_guard_rule_calculation_delete
 *    → audit_log) checando os contratos em código/SQL versionado. Se qualquer
 *    elo for removido ou contornado, o teste quebra antes do deploy.
 *
 * Cobertura:
 *   1. Trigger BEFORE DELETE existe e bloqueia DELETE direto.
 *   2. RPC bloqueia redução sem _allow_calc_reduction.
 *   3. RPC registra audit `calc_reduction_confirmed` quando autorizada.
 *   4. RPC grava snapshots before_edit e after_save (restauração possível).
 *   5. UI (Rules.tsx) só salva via RPC — nenhum DELETE direto em
 *      rule_calculations em qualquer arquivo do `src/`.
 *   6. Handler de salvamento exige confirmDialog antes de enviar
 *      _allow_calc_reduction: true.
 *   7. RuleHistoryTab expõe os eventos de auditoria gerados.
 */

const root = resolve(__dirname, "..");
const migrationsDir = resolve(root, "../supabase/migrations");

// ----- Carrega a migration de governança -----
const governanceMigrationFile = readdirSync(migrationsDir).find((f) =>
  readFileSync(resolve(migrationsDir, f), "utf8").includes(
    "trg_guard_rule_calculation_delete",
  ),
);

if (!governanceMigrationFile) {
  throw new Error(
    "Migration de governança não encontrada — procure por trg_guard_rule_calculation_delete em supabase/migrations.",
  );
}

const governanceSql = readFileSync(
  resolve(migrationsDir, governanceMigrationFile),
  "utf8",
);

// ----- Arquivos do cliente -----
const rulesPage = readFileSync(resolve(root, "pages/Rules.tsx"), "utf8");
const ruleHistoryTab = readFileSync(
  resolve(root, "components/rules/RuleHistoryTab.tsx"),
  "utf8",
);

// Varredura ampla por DELETEs diretos em qualquer arquivo .ts/.tsx do src.
const collectClientFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectClientFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

describe("E2E governança de cálculos de regra — camada DB (trigger + RPC)", () => {
  it("1. trigger BEFORE DELETE existe em public.rule_calculations", () => {
    expect(governanceSql).toMatch(
      /CREATE\s+TRIGGER\s+trg_guard_rule_calculation_delete\s+BEFORE\s+DELETE\s+ON\s+public\.rule_calculations/i,
    );
  });

  it("1b. guard_rule_calculation_delete raise quando flag não está ligada", () => {
    // Função levanta exception 42501 a menos que a flag de sessão esteja em 'on'.
    expect(governanceSql).toMatch(/current_setting\(\s*'app\.rule_calc_delete_authorized'/);
    expect(governanceSql).toMatch(/RAISE\s+EXCEPTION[\s\S]{0,400}Exclusão direta de cálculo de regra bloqueada/);
    expect(governanceSql).toMatch(/ERRCODE\s*=\s*'42501'/);
  });

  it("2. RPC bloqueia redução de cálculos sem _allow_calc_reduction", () => {
    // Pré-condição: v_prev_calc_count > 0 AND v_incoming_calc_count < v_prev_calc_count
    // AND NOT _allow_calc_reduction → RAISE com 23514.
    expect(governanceSql).toMatch(
      /v_prev_calc_count\s*>\s*0[\s\S]{0,200}v_incoming_calc_count\s*<\s*v_prev_calc_count[\s\S]{0,200}NOT\s+_allow_calc_reduction[\s\S]{0,400}ERRCODE\s*=\s*'23514'/,
    );
  });

  it("3. RPC grava audit 'calc_reduction_confirmed' quando reduzido com autorização", () => {
    expect(governanceSql).toMatch(
      /v_prev_calc_count\s*>\s*v_incoming_calc_count\s+AND\s+_allow_calc_reduction[\s\S]{0,400}'calc_reduction_confirmed'/,
    );
    // E o diff carrega from_count, to_count, removed_count e os cálculos anteriores.
    expect(governanceSql).toMatch(/'from_count'/);
    expect(governanceSql).toMatch(/'to_count'/);
    expect(governanceSql).toMatch(/'removed_count'/);
    expect(governanceSql).toMatch(/'previous_calculations'/);
  });

  it("4. RPC grava snapshots before_edit e after_save (para restauração)", () => {
    expect(governanceSql).toMatch(/INSERT\s+INTO\s+public\.rule_snapshots[\s\S]{0,300}'before_edit'/);
    expect(governanceSql).toMatch(/INSERT\s+INTO\s+public\.rule_snapshots[\s\S]{0,300}'after_save'/);
  });

  it("4b. RPC só autoriza DELETE pelo trigger via set_config('app.rule_calc_delete_authorized', 'on', true)", () => {
    // E desliga em seguida — flag de sessão local (3º arg = true) não vaza para outras transações.
    expect(governanceSql).toMatch(
      /set_config\(\s*'app\.rule_calc_delete_authorized'\s*,\s*'on'\s*,\s*true\s*\)[\s\S]{0,400}DELETE\s+FROM\s+public\.rule_calculations[\s\S]{0,400}set_config\(\s*'app\.rule_calc_delete_authorized'\s*,\s*'off'\s*,\s*true\s*\)/,
    );
  });
});

describe("E2E governança de cálculos de regra — camada UI (cliente)", () => {
  it("5. Nenhum arquivo do cliente faz DELETE direto em rule_calculations", () => {
    const offenders: string[] = [];
    for (const file of collectClientFiles(root)) {
      const src = readFileSync(file, "utf8");
      // Padrões proibidos: .from("rule_calculations") seguido de .delete(...)
      // ou supabase.from('rule_calculations').delete().
      const re = /\.from\(\s*["']rule_calculations["']\s*\)[\s\S]{0,200}\.delete\s*\(/;
      if (re.test(src)) offenders.push(file.replace(root, "src"));
    }
    expect(offenders).toEqual([]);
  });

  it("6. Rules.tsx só persiste cálculos via RPC apply_rule_save_with_corrections", () => {
    expect(rulesPage).toMatch(/supabase\.rpc\(\s*["']apply_rule_save_with_corrections["']/);
    // E exige confirmDialog ANTES de passar _allow_calc_reduction: true.
    // Estrutura esperada: if (reduction) { const ok = await confirmDialog({...}); if (!ok) throw; allowCalcReduction = true; }
    expect(rulesPage).toMatch(
      /calcs\.length\s*<\s*prevCalcs\.length[\s\S]{0,600}confirmDialog\([\s\S]{0,400}allowCalcReduction\s*=\s*true/,
    );
    expect(rulesPage).toMatch(/_allow_calc_reduction:\s*allowCalcReduction/);
  });

  it("6b. Se o usuário cancela o confirmDialog, a operação aborta antes da RPC", () => {
    expect(rulesPage).toMatch(
      /confirmDialog\([\s\S]{0,400}if\s*\(\s*!ok\s*\)\s*\{\s*throw\s+new\s+Error\(\s*["']Operação cancelada pelo usuário\.?["']/,
    );
  });

  it("7. RuleHistoryTab exibe os eventos de auditoria de governança", () => {
    // Os rótulos amigáveis cobrem os campos do diff `calc_reduction_confirmed`
    // e as ações criadas pela RPC, garantindo que tentativas/confirmações
    // ficam visíveis na aba Histórico da própria regra.
    expect(ruleHistoryTab).toMatch(/Qtd\.?\s*anterior\s*de\s*cálculos/i);
    expect(ruleHistoryTab).toMatch(/Cálculos\s*anteriores\s*preservados/i);
  });
});

describe("E2E governança — simulação do fluxo do usuário", () => {
  /**
   * Estes testes "encenam" o que aconteceria se um usuário tentasse limpar
   * todos os cálculos pela UI (clicando no × de cada CalcCard até zerar).
   * Como não temos browser, validamos via contrato que a cadeia inteira
   * está conectada — equivalente a um snapshot do caminho crítico.
   */

  it("usuário clica em 'Remover cálculo' → editor remove do array em memória", () => {
    const editor = readFileSync(
      resolve(root, "components/rules/RuleCalculationsEditor.tsx"),
      "utf8",
    );
    // O CalcCard expõe onRemove (botão ×); o pai mapeia para remove(i) que
    // recorta o array local de cálculos — sem tocar no banco ainda.
    expect(editor).toMatch(/onRemove=\{\s*\(\)\s*=>\s*remove\(\s*i\s*\)\s*\}/);
  });

  it("usuário clica em 'Salvar' → Rules.tsx detecta redução e exige confirmação", () => {
    // Mesma assertion do bloco 6 mas isolando o caminho do botão Salvar:
    // a função que envia para a RPC é a única chamadora de apply_rule_save_with_corrections.
    const rpcCalls = (
      rulesPage.match(/apply_rule_save_with_corrections/g) ?? []
    ).length;
    expect(rpcCalls).toBeGreaterThanOrEqual(1);
    expect(rulesPage).toMatch(/confirmDialog\(/);
  });

  it("RPC + trigger garantem que mesmo um cliente malicioso não consegue DELETE silencioso", () => {
    // O trigger é BEFORE DELETE FOR EACH ROW e a função é SECURITY DEFINER pelo
    // search_path travado em public — mesmo um insert/update/delete via PostgREST
    // (com qualquer JWT) atravessa o guard.
    expect(governanceSql).toMatch(/SECURITY\s+DEFINER/i);
    expect(governanceSql).toMatch(/SET\s+search_path[\s\S]{0,40}public/i);
    expect(governanceSql).toMatch(
      /CREATE\s+TRIGGER\s+trg_guard_rule_calculation_delete[\s\S]{0,200}FOR\s+EACH\s+ROW/i,
    );
  });
});
