// Testes dos flags introduzidos para resolver fallback silencioso:
//   - rule_calculations.is_catch_all: cálculo "piso", avaliado por último,
//     ignora whitelist/blacklist de procedure_codes/procedure_keywords.
//   - rules.prevent_external_fallback: quando a regra vence a seleção mas
//     nenhum cálculo bate, NÃO cai para a master geral; vai para sem_regra.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeItem, calcItemMatches, isRestrictiveCalculation } from "./rulesEngine.ts";

const baseItem = {
  id: "item-1",
  doctor_name: "Dr. Teste",
  doctor_document: null,
  company_name: "CIRURGIA TORACICA LTDA",
  company_id: "co-1",
  company_document: null,
  procedure_code: "30804183", // pleuroscopia
  procedure_name: "Pleuroscopia",
  description: null,
  access_route: null,
  doctor_role: "cirurgiao_principal",
  procedure_amount: 100,
  gross_amount: 100,
  attendance_number: "A1",
  patient_name: "Paciente",
  procedure_date: "2026-06-01",
  quantity: 1,
  agreement_name: "Bradesco Saude",
  specialty: null,
  sector: "centro_cirurgico",
  tipo_linha: null,
} as any;

const makeSpecificRule = (overrides: any = {}) => ({
  id: "r-toracica",
  name: "Cirurgia Torácica DF Star",
  rule_text: "",
  description: null,
  active: true,
  severity: "aviso",
  scope: "especifica",
  target_type: "empresa",
  target_company_id: "co-1",
  hospital_id: "h1",
  calculation_type: "tabela_diferenciada",
  ...overrides,
});

const masterRule = {
  id: "r-master",
  name: "Master Geral",
  rule_text: "",
  description: null,
  active: true,
  severity: "aviso",
  scope: "master",
  target_type: null,
  target_company_id: null,
  hospital_id: "h1",
  calculation_type: "percentual_sobre_convenio",
  convenio_percentage: 100,
  calculations: [
    {
      id: "cm",
      sort_order: 0,
      label: "Master 100% convênio",
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: 100,
    },
  ],
} as any;

Deno.test("is_catch_all: ignora whitelist de procedure_codes no calcItemMatches", () => {
  const c = {
    calculation_type: "tabela_diferenciada",
    procedure_codes: ["99999999"], // não inclui 30804183
    code_match_mode: "whitelist",
    is_catch_all: true,
  } as any;
  const m = calcItemMatches(c, baseItem);
  assertEquals(m.ok, true);
});

Deno.test("is_catch_all=false respeita whitelist normal", () => {
  const c = {
    calculation_type: "tabela_diferenciada",
    procedure_codes: ["99999999"],
    code_match_mode: "whitelist",
    is_catch_all: false,
  } as any;
  const m = calcItemMatches(c, baseItem);
  assertEquals(m.ok, false);
});

Deno.test("isRestrictiveCalculation: catch-all explícito nunca é restritivo", () => {
  const peers = [
    { calculation_type: "tabela_diferenciada", procedure_codes: ["10101010"], code_match_mode: "whitelist" } as any,
    { calculation_type: "tabela_diferenciada", is_catch_all: true } as any,
  ];
  assertEquals(isRestrictiveCalculation(peers[1], peers), false);
});

Deno.test("prevent_external_fallback=true bloqueia fallback para master", () => {
  const specific = makeSpecificRule({
    prevent_external_fallback: true,
    calculations: [
      {
        id: "c1",
        sort_order: 0,
        label: "Apenas código X",
        calculation_type: "valor_fixo",
        fixed_amount: 200,
        procedure_codes: ["99999999"], // não bate
        code_match_mode: "whitelist",
      },
    ],
  });
  const res = analyzeItem(baseItem, [specific, masterRule]);
  assertEquals(res.matched_priority, "sem_regra");
  // Garantiu que NÃO usou a master geral
  assertEquals(res.matched_rule_id, "r-toracica");
  // expected nulo — sem cálculo
  assertEquals(res.expected_amount, null);
});

Deno.test("prevent_external_fallback=false mantém fallback para master (legado)", () => {
  const specific = makeSpecificRule({
    prevent_external_fallback: false,
    calculations: [
      {
        id: "c1",
        sort_order: 0,
        label: "Apenas código X",
        calculation_type: "valor_fixo",
        fixed_amount: 200,
        procedure_codes: ["99999999"],
        code_match_mode: "whitelist",
      },
    ],
  });
  const res = analyzeItem(baseItem, [specific, masterRule]);
  // Caiu para master
  assertEquals(res.matched_rule_id, "r-master");
});

Deno.test("is_catch_all atende quando catch-all explícito no fim cobre o código", () => {
  const specific = makeSpecificRule({
    prevent_external_fallback: true,
    calculations: [
      {
        id: "c1",
        sort_order: 0,
        label: "Específico 10101010",
        calculation_type: "valor_fixo",
        fixed_amount: 50,
        procedure_codes: ["10101010"],
        code_match_mode: "whitelist",
      },
      {
        id: "c2",
        sort_order: 1,
        label: "Catch-all CBHPM x2 + 20%",
        calculation_type: "valor_fixo",
        fixed_amount: 500,
        is_catch_all: true,
      },
    ],
  });
  const res = analyzeItem(baseItem, [specific, masterRule]);
  assertEquals(res.matched_rule_id, "r-toracica");
  assertEquals(res.expected_amount, 500);
});
