/**
 * Regressão: filtro `special_case_filter = ['oncologico']` em UM cálculo
 * NÃO pode desabilitar o cálculo "Dobra Eletivos" (sem filtro de caso especial)
 * para itens eletivos comuns.
 *
 * Bug original: o filtro estava no nível da REGRA, bloqueando todos os cálculos
 * para itens sem caso especial aprovado. Após o fix, o filtro vive apenas no
 * cálculo específico — itens eletivos sem caso especial caem normalmente
 * no cálculo "Dobra Eletivos".
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

const ctx: PaymentContext = {
  sectors: ["centro_cirurgico"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-06-22",
};

function baseItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "it",
    doctor_name: "Dr Diego Burgardt",
    doctor_document: "111",
    company_name: "ACME",
    company_id: null,
    company_document: null,
    procedure_code: "31005497",
    procedure_name: "Procedimento",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 1454.26,
    gross_amount: 1454.26,
    attendance_number: "9226781",
    patient_name: "Paciente",
    procedure_date: "2026-06-22T10:00:00",
    quantity: 1,
    agreement_name: "Unimed",
    specialty: null,
    attendance_character: "ELETIVO",
    special_case_code: null,
    special_case_status: null,
    ...overrides,
  } as ItemInput;
}

const rule: RuleInput = {
  id: "r-diego",
  name: "Acordo Diego Burgardt",
  rule_text: "Dobra eletivos + Oncológico",
  description: null,
  active: true,
  severity: "aviso",
  scope: "doctor",
  sector: "centro_cirurgico",
  sectors: [],
  specialties: null,
  target_type: "doctor",
  target_identifier: "111",
  target_name: "Dr Diego Burgardt",
  target_company_id: null,
  procedure_codes: null,
  valid_from: null,
  valid_until: null,
  calculation_type: "percentual_convenio",
  convenio_percentage: null,
  fixed_amount: null,
  package_amount: null,
  extras_codes: null,
  // sem special_case_filter no nível da regra — esse é o ponto da regressão
  calculations: [
    {
      id: "calc-onco",
      sort_order: 0,
      label: "Oncológico 250%",
      calculation_type: "percentual_convenio",
      convenio_percentage: 250,
      code_match_mode: "any",
      special_case_filter: ["oncologico"],
    },
    {
      id: "calc-dobra",
      sort_order: 1,
      label: "Dobra Eletivos 200%",
      calculation_type: "percentual_convenio",
      convenio_percentage: 200,
      code_match_mode: "any",
      elective_mode: "eletivo",
    },
    {
      id: "calc-base",
      sort_order: 2,
      label: "Base 100%",
      calculation_type: "percentual_convenio",
      convenio_percentage: 100,
      code_match_mode: "any",
    },
  ],
} as any;

Deno.test("Item eletivo SEM caso especial cai em Dobra Eletivos (não é bloqueado pelo filtro oncológico)", () => {
  const out = analyzePaymentItems([baseItem()], [rule], ctx);
  assertEquals(out[0].matched_rule_id, "r-diego");
  assertEquals(out[0].matched_calculation_id, "calc-dobra");
  assert(out[0].selection_trace?.some((t: any) => t.calc_id === "calc-onco" && /caso_especial/.test(t.reason ?? "")),
    "esperado trace registrando que calc-onco foi descartado por caso_especial_nao_aprovado");
});

Deno.test("Item eletivo COM caso especial oncologico aprovado prefere cálculo oncológico (precedência)", () => {
  const onco = baseItem({
    id: "it-onco",
    special_case_code: "oncologico",
    special_case_status: "approved",
  });
  const out = analyzePaymentItems([onco], [rule], ctx);
  assertEquals(out[0].matched_calculation_id, "calc-onco");
});

Deno.test("Item de urgência sem caso especial NÃO cai em Dobra Eletivos — usa Base 100%", () => {
  const urg = baseItem({ id: "it-urg", attendance_character: "URGENCIA" });
  const out = analyzePaymentItems([urg], [rule], ctx);
  assertEquals(out[0].matched_calculation_id, "calc-base");
});
