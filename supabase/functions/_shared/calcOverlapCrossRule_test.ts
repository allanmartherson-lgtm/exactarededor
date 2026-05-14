/**
 * Testes do helper detectCrossRuleOverlap — usado pela Verificação B revisada
 * em validate-rule-save: confirma se duas regras DIFERENTES, com a mesma
 * empresa, realmente disputam o mesmo item em runtime.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectCrossRuleOverlap } from "./calcOverlap.ts";
import type { RuleCalculationItem } from "./rulesEngine.ts";

const calc = (over: Partial<RuleCalculationItem>): RuleCalculationItem => ({
  id: crypto.randomUUID(),
  sort_order: 0,
  label: "calc",
  calculation_type: "valor_fixo",
  fixed_amount: 100,
  code_match_mode: "any",
  ...over,
});

Deno.test("cross/1 — códigos disjuntos (whitelists) → sem overlap", () => {
  const A = [calc({ procedure_codes: ["AAAAA"], code_match_mode: "whitelist" })];
  const B = [calc({ procedure_codes: ["BBBBB"], code_match_mode: "whitelist" })];
  assertEquals(detectCrossRuleOverlap(A, B), []);
});

Deno.test("cross/2 — códigos com interseção → overlap mencionando código", () => {
  const A = [calc({ procedure_codes: ["X", "Y"], code_match_mode: "whitelist" })];
  const B = [calc({ procedure_codes: ["Y", "Z"], code_match_mode: "whitelist" })];
  const out = detectCrossRuleOverlap(A, B);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("y")) {
    throw new Error("descrição deve citar o código compartilhado");
  }
});

Deno.test("cross/3 — eixos diferentes restritos (códigos × função) sem vazio → overlap", () => {
  const A = [calc({ procedure_codes: ["X"], code_match_mode: "whitelist" })];
  const B = [calc({ doctor_roles: ["cirurgiao"] })];
  assertEquals(detectCrossRuleOverlap(A, B).length, 1);
});

Deno.test("cross/4 — modalidades diferentes (eletivo × urgencia) → eixo vazio", () => {
  const A = [calc({ elective_mode: "eletivo", procedure_codes: ["X"], code_match_mode: "whitelist" })];
  const B = [calc({ elective_mode: "urgencia", procedure_codes: ["X"], code_match_mode: "whitelist" })];
  assertEquals(detectCrossRuleOverlap(A, B), []);
});

Deno.test("cross/5 — ambos lados com vários cálculos: 1 par overlap basta", () => {
  const A = [
    calc({ id: "a1", procedure_codes: ["AAA"], code_match_mode: "whitelist" }),
    calc({ id: "a2", procedure_codes: ["BBB"], code_match_mode: "whitelist" }),
  ];
  const B = [
    calc({ id: "b1", procedure_codes: ["BBB"], code_match_mode: "whitelist" }),
    calc({ id: "b2", procedure_codes: ["CCC"], code_match_mode: "whitelist" }),
  ];
  const out = detectCrossRuleOverlap(A, B);
  assertEquals(out.length, 1);
  assertEquals(out[0].calc_a_id, "a2");
  assertEquals(out[0].calc_b_id, "b1");
});

Deno.test("cross/6 — algum lado sem cálculos → catch-all conservador (overlap)", () => {
  const A = [calc({ procedure_codes: ["X"], code_match_mode: "whitelist" })];
  assertEquals(detectCrossRuleOverlap(A, []).length, 1);
  assertEquals(detectCrossRuleOverlap([], A).length, 1);
});

Deno.test("cross/7 — caso DF NEURO real: Crânio (código X) × Hemodinâmica (código Y) → sem overlap", () => {
  // Simula as duas regras: Crânio cobre TUSS de neurocirurgia craniana,
  // Hemodinâmica cobre TUSS de procedimentos endovasculares — disjuntos.
  const cranio = [calc({
    id: "cranio",
    procedure_codes: ["30715091"],
    code_match_mode: "whitelist",
  })];
  const hemo = [calc({
    id: "hemo",
    procedure_codes: ["30912018"],
    code_match_mode: "whitelist",
  })];
  assertEquals(detectCrossRuleOverlap(cranio, hemo), []);
});
