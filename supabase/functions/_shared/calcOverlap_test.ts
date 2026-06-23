/**
 * Sub-Onda 2D — Testes do helper detectCalcOverlap (Verificação D).
 *
 * Cobertura desta suíte (Tests 4, 5, 6 do prompt original — os demais
 * (1, 2, 3, 7, 8) dependem da função SQL `validate_rule_save` autenticada
 * e ficam para a Rodada 2.5 / 3 quando houver harness com auth.uid()
 * configurada).
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectCalcOverlap } from "./calcOverlap.ts";
import type { RuleCalculationItem } from "./rulesEngine.ts";

// --- Teste 4: 2 cálculos restritivos com códigos sobrepostos → calc_overlap ---
Deno.test("2D/4 — 2 restritivos com whitelist sobrepostos → calc_overlap mencionando código compartilhado", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "calc-1", sort_order: 0, label: "Calc 1",
      calculation_type: "valor_fixo", fixed_amount: 100,
      procedure_codes: ["30715091", "30715100"], code_match_mode: "whitelist",
    },
    {
      id: "calc-2", sort_order: 1, label: "Calc 2",
      calculation_type: "valor_fixo", fixed_amount: 200,
      procedure_codes: ["30715091", "30715200"], code_match_mode: "whitelist",
    },
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  assertEquals(out[0].type, "calc_overlap");
  assertEquals(out[0].calc_a_id, "calc-1");
  assertEquals(out[0].calc_b_id, "calc-2");
  if (!out[0].intersection_description.includes("30715091")) {
    throw new Error("Descrição deve mencionar código compartilhado 30715091");
  }
});

// --- Teste 5: cálculos sem overlap (whitelists disjuntas) ---
Deno.test("2D/5 — 2 restritivos com whitelist disjuntas → sem problemas", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "calc-A", sort_order: 0, label: "Calc A",
      calculation_type: "valor_fixo", fixed_amount: 100,
      procedure_codes: ["AAAAA"], code_match_mode: "whitelist",
    },
    {
      id: "calc-B", sort_order: 1, label: "Calc B",
      calculation_type: "valor_fixo", fixed_amount: 200,
      procedure_codes: ["BBBBB"], code_match_mode: "whitelist",
    },
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// --- Teste 6: catch-all + restritivo → sem calc_overlap ---
Deno.test("2D/6 — restritivo + catch-all puro → sem calc_overlap (catch-all não compete)", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "calc-rest", sort_order: 0, label: "Restritivo",
      calculation_type: "valor_fixo", fixed_amount: 700,
      procedure_codes: ["30715091"], code_match_mode: "whitelist",
    },
    {
      id: "calc-any", sort_order: 1, label: "Catch-all",
      calculation_type: "valor_fixo", fixed_amount: 100,
      code_match_mode: "any",
    },
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// --- Cobertura adicional (não conta nos 8 do prompt; sanity-check do helper) ---
Deno.test("2D/extra — eixos diferentes (códigos × função) sem eixo vazio → conflita", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "rest-cod", sort_order: 0, label: "Por código",
      calculation_type: "valor_fixo", fixed_amount: 300,
      procedure_codes: ["X"], code_match_mode: "whitelist",
    },
    {
      id: "rest-func", sort_order: 1, label: "Por função",
      calculation_type: "valor_fixo", fixed_amount: 400,
      doctor_roles: ["cirurgiao"], code_match_mode: "any",
    },
  ];
  // Eixos diferentes, nenhum vazio → conflita (item com cód=X E role=cirurgiao casa em ambos).
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
});

Deno.test("2D/extra — modalidades diferentes (eletivo × urgencia) → eixo vazio, sem conflito", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "el", sort_order: 0, label: "Eletivo",
      calculation_type: "valor_fixo", fixed_amount: 100,
      elective_mode: "eletivo",
      procedure_codes: ["X"], code_match_mode: "whitelist",
    },
    {
      id: "ur", sort_order: 1, label: "Urgência",
      calculation_type: "valor_fixo", fixed_amount: 200,
      elective_mode: "urgencia",
      procedure_codes: ["X"], code_match_mode: "whitelist",
    },
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

Deno.test("2D/extra — agreements whitelist disjuntos → sem conflito", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "br", sort_order: 0, label: "Bradesco",
      calculation_type: "valor_fixo", fixed_amount: 100,
      agreement_aliases: ["Bradesco"], agreement_match_mode: "whitelist",
      doctor_roles: ["cirurgiao"],
    },
    {
      id: "un", sort_order: 1, label: "Unimed",
      calculation_type: "valor_fixo", fixed_amount: 200,
      agreement_aliases: ["Unimed"], agreement_match_mode: "whitelist",
      doctor_roles: ["cirurgiao"],
    },
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// --- payment_type_id separa Parecer × Visita (regressão do falso-positivo) ---
Deno.test("2D/payment-type — mesmo código, payment_type_id diferente (Parecer × Visita) → sem conflito", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "parecer", sort_order: 0, label: "Parecer",
      calculation_type: "valor_fixo", fixed_amount: 150,
      procedure_codes: ["10101012"], code_match_mode: "whitelist",
      payment_type_id: "pt-parecer",
    } as any,
    {
      id: "visita", sort_order: 1, label: "Visita",
      calculation_type: "valor_fixo", fixed_amount: 80,
      procedure_codes: ["10101012"], code_match_mode: "whitelist",
      payment_type_id: "pt-visita",
    } as any,
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

Deno.test("2D/payment-type — mesmo código + mesmo payment_type_id → conflita", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "a", sort_order: 0, label: "A",
      calculation_type: "valor_fixo", fixed_amount: 150,
      procedure_codes: ["10101012"], code_match_mode: "whitelist",
      payment_type_id: "pt-parecer",
    } as any,
    {
      id: "b", sort_order: 1, label: "B",
      calculation_type: "valor_fixo", fixed_amount: 200,
      procedure_codes: ["10101012"], code_match_mode: "whitelist",
      payment_type_id: "pt-parecer",
    } as any,
  ];
  assertEquals(detectCalcOverlap(calcs).length, 1);
});

Deno.test("2D/payment-type — payment_type_id apenas em um lado (universo vs restrito) → não bloqueia outros eixos", () => {
  const calcs: RuleCalculationItem[] = [
    {
      id: "any-pt", sort_order: 0, label: "Sem PT",
      calculation_type: "valor_fixo", fixed_amount: 100,
      procedure_codes: ["X"], code_match_mode: "whitelist",
    } as any,
    {
      id: "with-pt", sort_order: 1, label: "Com PT",
      calculation_type: "valor_fixo", fixed_amount: 200,
      procedure_codes: ["X"], code_match_mode: "whitelist",
      payment_type_id: "pt-visita",
    } as any,
  ];
  // Eixo PT: um lado é "any" → shared:false (não vazio). Códigos conflitam → conflita.
  assertEquals(detectCalcOverlap(calcs).length, 1);
});

// --- Cross-rule: payment_type_id diferente em regras distintas → sem overlap ---
import { detectCrossRuleOverlap } from "./calcOverlap.ts";
Deno.test("2D/payment-type cross-rule — Parecer (regra X) × Visita (regra Y) mesmo código → sem overlap cruzado", () => {
  const ruleA: RuleCalculationItem[] = [{
    id: "ra-parecer", sort_order: 0, label: "Parecer",
    calculation_type: "valor_fixo", fixed_amount: 150,
    procedure_codes: ["10101012"], code_match_mode: "whitelist",
    payment_type_id: "pt-parecer",
  } as any];
  const ruleB: RuleCalculationItem[] = [{
    id: "rb-visita", sort_order: 0, label: "Visita",
    calculation_type: "valor_fixo", fixed_amount: 80,
    procedure_codes: ["10101012"], code_match_mode: "whitelist",
    payment_type_id: "pt-visita",
  } as any];
  assertEquals(detectCrossRuleOverlap(ruleA, ruleB), []);
});

