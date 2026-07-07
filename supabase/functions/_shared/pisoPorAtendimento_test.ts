/**
 * Piso por procedimento com escopo `por_atendimento`.
 *
 * Cenários validados no post-pass `applyPisoPorAtendimento`:
 *  - Soma do convênio ≥ piso → mantém expected por item, método "convenio".
 *  - Soma do convênio < piso → distribui piso pro-rata pelos itens do grupo,
 *    método "piso"; a última linha absorve o resíduo de centavos.
 *  - Convênio zero em todos os itens → divide piso igualmente entre os itens.
 *  - Não afeta itens de outras regras/atendimentos/médicos.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyPisoPorAtendimento, type AnalysisResult, type ItemInput } from "./rulesEngine.ts";

function mkResult(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    item_id: "",
    status: "aprovado",
    expected_amount: 0,
    diff_pct: 0,
    matched_rule_id: "R1",
    matched_rule_name: "Regra",
    matched_priority: "regra_especifica",
    calculation_type_used: "percentual_sobre_convenio",
    calculation_explanation: "",
    alerts: [],
    needs_ai_review: false,
    piso_escopo: "por_atendimento",
    piso_aplicado_valor: 1100,
    piso_metodo_vencedor: null,
    ...overrides,
  } as AnalysisResult;
}

function mkItem(overrides: Partial<ItemInput>): ItemInput {
  return {
    id: "i1",
    attendance_number: "AT-1",
    doctor_id: "D1",
    doctor_name: null,
    doctor_role: "Cirurgião Principal",
    procedure_code: "1234",
    procedure_amount: 0,
    gross_amount: 0,
    quantity: 1,
    ...overrides,
  } as ItemInput;
}

Deno.test("por_atendimento: soma convênio > piso → mantém valores e marca 'convenio'", () => {
  const results = [
    mkResult({ item_id: "a", expected_amount: 800 }),
    mkResult({ item_id: "b", expected_amount: 400 }),
  ];
  const items = [mkItem({ id: "a" }), mkItem({ id: "b" })];
  applyPisoPorAtendimento(results, items);
  assertEquals(results[0].expected_amount, 800);
  assertEquals(results[1].expected_amount, 400);
  assertEquals(results[0].piso_metodo_vencedor, "convenio");
  assertEquals(results[1].piso_metodo_vencedor, "convenio");
});

Deno.test("por_atendimento: piso vence → distribui pro-rata e casa centavos", () => {
  const results = [
    mkResult({ item_id: "a", expected_amount: 600 }),
    mkResult({ item_id: "b", expected_amount: 200 }),
  ];
  const items = [mkItem({ id: "a" }), mkItem({ id: "b" })];
  applyPisoPorAtendimento(results, items);
  // 600/800 * 1100 = 825; 200/800 * 1100 = 275. Soma = 1100 exato.
  assertEquals(results[0].expected_amount, 825);
  assertEquals(results[1].expected_amount, 275);
  assertEquals(results[0].piso_metodo_vencedor, "piso");
  assertEquals(results[1].piso_metodo_vencedor, "piso");
});

Deno.test("por_atendimento: convênio zero em todos → divide piso igualmente", () => {
  const results = [
    mkResult({ item_id: "a", expected_amount: 0 }),
    mkResult({ item_id: "b", expected_amount: 0 }),
  ];
  const items = [mkItem({ id: "a" }), mkItem({ id: "b" })];
  applyPisoPorAtendimento(results, items);
  assertEquals(results[0].expected_amount, 550);
  assertEquals(results[1].expected_amount, 550);
  assertEquals(results[0].piso_metodo_vencedor, "piso");
});

Deno.test("por_atendimento: não mistura médicos diferentes no mesmo atendimento", () => {
  const results = [
    mkResult({ item_id: "a", expected_amount: 300 }),
    mkResult({ item_id: "b", expected_amount: 300 }),
  ];
  const items = [
    mkItem({ id: "a", doctor_id: "D1" }),
    mkItem({ id: "b", doctor_id: "D2" }),
  ];
  applyPisoPorAtendimento(results, items);
  // Cada médico tem sozinho 300 vs piso 1100 → piso vence isoladamente.
  assertEquals(results[0].expected_amount, 1100);
  assertEquals(results[1].expected_amount, 1100);
});

Deno.test("por_atendimento: ignora resultados sem escopo por_atendimento", () => {
  const results = [
    mkResult({ item_id: "a", expected_amount: 500, piso_escopo: "por_item", piso_metodo_vencedor: "convenio" }),
  ];
  applyPisoPorAtendimento(results, [mkItem({ id: "a" })]);
  assertEquals(results[0].expected_amount, 500);
  assertEquals(results[0].piso_metodo_vencedor, "convenio");
});
