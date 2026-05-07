/**
 * Garante a regra de projeto:
 *   "Especialidade médica é apenas relatório/busca/filtro — nunca impacta
 *   cálculo, status ou seleção de regra."
 *
 * Cobertura:
 *   1. `preFilterRules` NÃO descarta regras com `specialties` que não
 *      intersectam `payments.specialties` (campo de relatório).
 *   2. `selectWinningRule` escolhe a regra mesmo quando `item.specialty`
 *      é diferente de `rule.specialties` (não pode entrar como eixo).
 *   3. Trace não marca candidatas como `filtered_specialty`.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  preFilterRules,
  selectWinningRule,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

function makeRule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: "rule-1",
    name: "Regra Empresa ACME",
    rule_text: "100% do convênio para ACME",
    description: null,
    active: true,
    severity: "aviso",
    scope: "especifica",
    sector: "outro",
    sectors: ["outro"],
    specialties: null,
    target_type: "empresa",
    target_identifier: "12345678000199",
    target_name: "ACME LTDA",
    target_company_id: "company-1",
    procedure_codes: null,
    applies_payment_types: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "percentual_sobre_convenio",
    convenio_percentage: 100,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    ...overrides,
  } as RuleInput;
}

function makeItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "item-1",
    doctor_name: "Dra. Fulana",
    doctor_document: "111111",
    company_name: "ACME LTDA",
    company_id: "company-1",
    company_document: "12345678000199",
    procedure_code: "31303293",
    procedure_name: "Procedimento X",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 100,
    gross_amount: 100,
    attendance_number: "999",
    patient_name: "Paciente",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: null,
    specialty: "Cardiologia",
    ...overrides,
  } as ItemInput;
}

const baseCtx: PaymentContext = {
  sectors: ["outro"],
  specialties: ["Ginecologia"], // intencionalmente diferente
  payment_type: null,
  reference_date: "2026-05-01",
};

Deno.test("preFilterRules NÃO descarta regra cuja specialties não bate com ctx.specialties", () => {
  const rule = makeRule({ specialties: ["Ortopedia", "Pediatria"] });
  const out = preFilterRules([rule], baseCtx);
  assertEquals(out.length, 1, "regra deve permanecer mesmo sem intersecção de especialidades");
  assertEquals(out[0].id, rule.id);
});

Deno.test("preFilterRules ignora rule.specialties em todas as combinações", () => {
  const rules: RuleInput[] = [
    makeRule({ id: "a", specialties: null }),
    makeRule({ id: "b", specialties: [] }),
    makeRule({ id: "c", specialties: ["Cardiologia"] }),
    makeRule({ id: "d", specialties: ["Inexistente"] }),
  ];
  const ctxEmpty: PaymentContext = { ...baseCtx, specialties: [] };
  assertEquals(preFilterRules(rules, baseCtx).length, 4);
  assertEquals(preFilterRules(rules, ctxEmpty).length, 4);
});

Deno.test("selectWinningRule escolhe regra mesmo quando item.specialty difere de rule.specialties", () => {
  const rule = makeRule({ specialties: ["Ortopedia"] });
  const item = makeItem({ specialty: "Cardiologia" });
  const outcome = selectWinningRule(item, [rule]);
  assert(outcome, "deveria existir um SelectionOutcome");
  assertEquals(outcome!.rule?.id, rule.id, "regra deve vencer apesar de specialty divergente");
  assertEquals(outcome!.priority, "empresa");
});

Deno.test("selectWinningRule não usa item.specialty como tie-breaker nem filtro", () => {
  // Duas regras, ambas casam em empresa. A com specialty 'igual' à do item
  // não pode ter vantagem — desempate é por severidade/vigência, nunca por specialty.
  const a = makeRule({ id: "a", specialties: ["Cardiologia"], severity: "aviso" });
  const b = makeRule({ id: "b", specialties: ["Ortopedia"], severity: "bloqueio" });
  const item = makeItem({ specialty: "Cardiologia" });
  const outcome = selectWinningRule(item, [a, b]);
  assert(outcome);
  assertEquals(outcome!.rule?.id, "b", "vence a regra com maior severidade, não a de specialty igual");
});

Deno.test("trace não marca candidatas como filtered_specialty", () => {
  const rule = makeRule({ specialties: ["Inexistente"] });
  const item = makeItem({ specialty: "Cardiologia" });
  const outcome = selectWinningRule(item, [rule], { collectTrace: true });
  assert(outcome?.trace);
  for (const lvl of outcome!.trace!.levels) {
    for (const c of lvl.candidates) {
      assert(
        c.result !== "filtered_specialty",
        `candidata ${c.rule_id} marcada como filtered_specialty (não permitido)`,
      );
    }
  }
});
