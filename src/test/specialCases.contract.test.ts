import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Testes de contrato do fluxo de Casos Especiais (mark → decide →
 * banner retroativo → ajuste retroativo formal).
 *
 * Por que contract-style? Mesma razão do ruleCalcGovernance.e2e.test.ts:
 * o projeto roda só Vitest e mocks de Supabase/RPC não exercitariam as
 * regras reais. Aqui validamos que as camadas que importam (auth, gate
 * de redução, snapshot, vínculo mark↔adjustment, imutabilidade do
 * pagamento fechado) continuam plugadas.
 */

const root = resolve(__dirname, "..");
const fnsDir = resolve(root, "../supabase/functions");
const migrationsDir = resolve(root, "../supabase/migrations");

const markFn = readFileSync(resolve(fnsDir, "mark-special-case/index.ts"), "utf8");
const decideFn = readFileSync(resolve(fnsDir, "decide-special-case/index.ts"), "utf8");
const adjustFn = readFileSync(resolve(fnsDir, "special-case-adjust/index.ts"), "utf8");
const banner = readFileSync(
  resolve(root, "components/payment-detail/SpecialCaseRetroactiveBanner.tsx"), "utf8");
const adjustDialog = readFileSync(
  resolve(root, "components/payment-detail/SpecialCaseRetroactiveAdjustDialog.tsx"), "utf8");

const allMigrations = readdirSync(migrationsDir)
  .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
  .join("\n\n");

describe("Special cases — auth & validation", () => {
  it("mark-special-case exige Bearer token e valida com getUser()", () => {
    expect(markFn).toMatch(/authHeader.*Bearer/);
    expect(markFn).toMatch(/auth\.getUser\(\)/);
    expect(markFn).toMatch(/special_case_types[\s\S]{0,200}eq\(\s*"active"\s*,\s*true\s*\)/);
  });

  it("mark-special-case define origin/status conforme role", () => {
    // analista cria pending; gestao_medica/diretor/admin já approved.
    expect(markFn).toMatch(/roleSet\.has\(\s*"gestao_medica"\s*\)/);
    expect(markFn).toMatch(/initialStatus\s*=\s*isGestao\s*\?\s*"approved"\s*:\s*"pending"/);
  });

  it("mark-special-case notifica gestão médica quando pending", () => {
    expect(markFn).toMatch(/internal_notifications/);
    expect(markFn).toMatch(/role[\s\S]{0,40}gestao_medica/);
  });

  it("decide-special-case só permite admin/diretor/gestao_medica", () => {
    expect(decideFn).toMatch(/admin[\s\S]{0,80}diretor[\s\S]{0,80}gestao_medica/);
    expect(decideFn).toMatch(/canDecide/);
  });
});

describe("Special cases — gate de redução no ajuste retroativo", () => {
  it("special-case-adjust exige role decisor para persistir (!preview)", () => {
    expect(adjustFn).toMatch(/canDecide[\s\S]{0,80}admin[\s\S]{0,40}diretor[\s\S]{0,40}gestao_medica/);
    expect(adjustFn).toMatch(/!body\.preview\s*&&\s*!canDecide[\s\S]{0,200}forbidden_role/);
  });

  it("special-case-adjust bloqueia redução sem allow_reduction (gate)", () => {
    expect(adjustFn).toMatch(
      /totalReducao\s*<\s*0\s*&&\s*!body\.allow_reduction[\s\S]{0,200}reduction_requires_confirmation/,
    );
  });

  it("special-case-adjust exige pagamento FECHADO (imutabilidade do snapshot)", () => {
    expect(adjustFn).toMatch(/CLOSED\.has\(payment\.status\)/);
    expect(adjustFn).toMatch(/payment_not_closed/);
  });

  it("special-case-adjust valida que marks são approved e do mesmo payment", () => {
    expect(adjustFn).toMatch(/m\.payment_id\s*!==\s*body\.payment_id\s*\|\|\s*m\.status\s*!==\s*"approved"/);
  });

  it("special-case-adjust impede reuso de marks já materializadas", () => {
    expect(adjustFn).toMatch(/retro_adjustment_id[\s\S]{0,200}marks_already_applied/);
  });

  it("special-case-adjust registra audit_log com snapshot do diff", () => {
    expect(adjustFn).toMatch(
      /audit_log[\s\S]{0,400}special_case_retro_adjust[\s\S]{0,400}summary[\s\S]{0,200}allow_reduction/,
    );
  });

  it("special-case-adjust vincula special_case_marks.retro_adjustment_id após criar ajuste", () => {
    expect(adjustFn).toMatch(/special_case_marks[\s\S]{0,200}retro_adjustment_id:\s*adj\.id/);
  });
});

describe("Special cases — banner retroativo (UI)", () => {
  it("banner usa payment_status_history.changed_at como cutoff de fechamento", () => {
    expect(banner).toMatch(/payment_status_history[\s\S]{0,300}status_to/);
    expect(banner).toMatch(/CLOSED_STATUSES\.has\(h\.status_to\)/);
  });

  it("banner NÃO invoca analyze-payment direto (pagamento fechado é imutável)", () => {
    expect(banner).not.toMatch(/analyze-payment/);
  });

  it("banner filtra marcações já materializadas (retro_adjustment_id != null)", () => {
    expect(banner).toMatch(/m\.retro_adjustment_id/);
  });

  it("dialog de ajuste exige preview antes de aplicar e checkbox para reduções", () => {
    expect(adjustDialog).toMatch(/special-case-adjust[\s\S]{0,200}preview:\s*true/);
    expect(adjustDialog).toMatch(/needsReductionConfirm[\s\S]{0,200}allowReduction/);
    expect(adjustDialog).toMatch(/allow_reduction:\s*allowReduction/);
  });
});

describe("Special cases — schema", () => {
  it("special_case_marks tem coluna retro_adjustment_id (vínculo com ajuste)", () => {
    expect(allMigrations).toMatch(
      /ALTER\s+TABLE\s+public\.special_case_marks[\s\S]{0,400}retro_adjustment_id\s+uuid/i,
    );
  });

  it("special_case_marks tem trigger que sincroniza payment_items.special_case_*", () => {
    expect(allMigrations).toMatch(/trg_special_case_marks_after_change/);
    expect(allMigrations).toMatch(/apply_special_case_to_items/);
  });

  it("rules.special_case_filter existe como text[]", () => {
    expect(allMigrations).toMatch(
      /ALTER\s+TABLE\s+public\.rules[\s\S]{0,400}special_case_filter[\s\S]{0,40}text\[\]/i,
    );
  });
});
