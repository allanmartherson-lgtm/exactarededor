/**
 * Testes da refatoração "filtros por Cálculo".
 *
 * Cobertura:
 *   1. Bônus Final de Semana com 3 cálculos:
 *      - Cálculo 1: 3 códigos de Cirurgia Geral → bônus R$ 1500
 *      - Cálculo 2: 1 código Bariátrica         → bônus R$ 3000
 *      - Cálculo 3: fallback geral (sem códigos) → bônus R$ 500
 *   2. Prioridade via sort_order (first_match).
 *   3. Sem herança: regra sem restritivos no topo não filtra nada por si só.
 *   4. Convênio whitelist por cálculo.
 *   5. Função do médico (doctor_roles) por cálculo.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

const baseCtx: PaymentContext = {
  sectors: ["outro"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-05-09", // sábado
};

function rule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: "r-bonus-fds",
    name: "Bônus Final de Semana",
    rule_text: "Bônus por código no fim de semana",
    description: null,
    active: true,
    severity: "aviso",
    scope: "master",
    sector: "outro",
    sectors: [],
    specialties: null,
    target_type: null,
    target_identifier: null,
    target_name: null,
    target_company_id: null,
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "bonus",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    ...overrides,
  } as RuleInput;
}

function item(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "i",
    doctor_name: "Dr X",
    doctor_document: "1",
    company_name: "ACME",
    company_id: null,
    company_document: null,
    procedure_code: "00000000",
    procedure_name: "P",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião",
    procedure_amount: 100,
    gross_amount: 100,
    attendance_number: "1",
    patient_name: "P",
    procedure_date: "2026-05-09T10:00:00", // sábado
    quantity: 1,
    agreement_name: null,
    specialty: null,
    ...overrides,
  } as ItemInput;
}

const CIRURGIA_GERAL = ["31001010", "31001029", "31001037"];
const BARIATRICA = "31005989";

const fdsRule = rule({
  calculations: [
    {
      id: "c1",
      sort_order: 0,
      label: "Cirurgia Geral FDS",
      calculation_type: "bonus",
      bonus_amount: 1500,
      procedure_codes: CIRURGIA_GERAL,
      code_match_mode: "whitelist",
      time_mode: "fim_de_semana",
    },
    {
      id: "c2",
      sort_order: 1,
      label: "Bariátrica FDS",
      calculation_type: "bonus",
      bonus_amount: 3000,
      procedure_codes: [BARIATRICA],
      code_match_mode: "whitelist",
      time_mode: "fim_de_semana",
    },
    {
      id: "c3",
      sort_order: 2,
      label: "Fallback FDS",
      calculation_type: "bonus",
      bonus_amount: 500,
      code_match_mode: "any",
      time_mode: "fim_de_semana",
    },
  ],
} as any);

Deno.test("Bônus FDS — código de Cirurgia Geral cai no Cálculo 1 (R$ 1500)", () => {
  const r = analyzePaymentItems([item({ procedure_code: CIRURGIA_GERAL[1] })], [fdsRule], baseCtx);
  assertEquals(r[0].matched_rule_id, fdsRule.id);
  assertEquals(r[0].expected_amount, 1500);
});

Deno.test("Bônus FDS — código de Bariátrica cai no Cálculo 2 (R$ 3000)", () => {
  const r = analyzePaymentItems([item({ procedure_code: BARIATRICA })], [fdsRule], baseCtx);
  assertEquals(r[0].expected_amount, 3000);
});

Deno.test("Bônus FDS — código não listado cai no Fallback (R$ 500)", () => {
  const r = analyzePaymentItems([item({ procedure_code: "99999999" })], [fdsRule], baseCtx);
  assertEquals(r[0].expected_amount, 500);
});

Deno.test("Bônus FDS — dia útil não casa nenhum cálculo (sem_regra)", () => {
  const weekdayItem = item({
    procedure_code: CIRURGIA_GERAL[0],
    procedure_date: "2026-05-06T10:00:00", // quarta
  });
  const ctx = { ...baseCtx, reference_date: "2026-05-06" };
  const r = analyzePaymentItems([weekdayItem], [fdsRule], ctx);
  // Item bate na regra (master) mas nenhum cálculo casa → expected null.
  assertEquals(r[0].expected_amount, null);
});

Deno.test("Prioridade — sort_order define o vencedor (first_match)", () => {
  // Mesmo código aparece nos dois primeiros cálculos: vence o de menor sort_order.
  const r = rule({
    calculations: [
      { id: "a", sort_order: 0, label: "primeiro", calculation_type: "valor_fixo", fixed_amount: 100, code_match_mode: "any" },
      { id: "b", sort_order: 1, label: "segundo",  calculation_type: "valor_fixo", fixed_amount: 999, code_match_mode: "any" },
    ],
  } as any);
  const out = analyzePaymentItems([item()], [r], baseCtx);
  assertEquals(out[0].expected_amount, 100);
});

Deno.test("Sem herança — regra sem restritivos no topo + cálculo any aceita qualquer item", () => {
  const r = rule({
    procedure_codes: null,
    sectors: [],
    agreement_aliases: [],
    calculations: [
      { id: "x", sort_order: 0, label: "geral", calculation_type: "valor_fixo", fixed_amount: 42, code_match_mode: "any" },
    ],
  } as any);
  const out = analyzePaymentItems([
    item({ procedure_code: "11111111", agreement_name: "Qualquer" }),
    item({ id: "i2", procedure_code: "22222222", agreement_name: "Outro" }),
  ], [r], baseCtx);
  assertEquals(out[0].expected_amount, 42);
  assertEquals(out[1].expected_amount, 42);
});

Deno.test("Convênio whitelist por cálculo — só Bradesco entra no Cálculo 1", () => {
  const r = rule({
    calculations: [
      {
        id: "c1", sort_order: 0, label: "Bradesco", calculation_type: "valor_fixo", fixed_amount: 200,
        agreement_match_mode: "whitelist", agreement_aliases: ["Bradesco Saude"],
        code_match_mode: "any",
      },
      {
        id: "c2", sort_order: 1, label: "Demais", calculation_type: "valor_fixo", fixed_amount: 50,
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems([
    item({ id: "a", agreement_name: "Bradesco Saúde" }),
    item({ id: "b", agreement_name: "Unimed" }),
  ], [r], baseCtx);
  assertEquals(out[0].expected_amount, 200);
  assertEquals(out[1].expected_amount, 50);
});

Deno.test("Função do médico por cálculo — auxiliar separado de cirurgião", () => {
  const r = rule({
    calculations: [
      { id: "cir", sort_order: 0, label: "Cirurgião",  calculation_type: "valor_fixo", fixed_amount: 1000,
        doctor_roles: ["cirurgiao"], code_match_mode: "any" },
      { id: "aux", sort_order: 1, label: "Aux 1",      calculation_type: "valor_fixo", fixed_amount: 300,
        doctor_roles: ["primeiro_aux"], code_match_mode: "any" },
      { id: "fb",  sort_order: 2, label: "Fallback",   calculation_type: "valor_fixo", fixed_amount: 0,
        code_match_mode: "any" },
    ],
  } as any);
  const out = analyzePaymentItems([
    item({ id: "x", doctor_role: "Cirurgião Principal" }),
    item({ id: "y", doctor_role: "1º Auxiliar" }),
    item({ id: "z", doctor_role: "Instrumentador" }),
  ], [r], baseCtx);
  assertEquals(out[0].expected_amount, 1000);
  assertEquals(out[1].expected_amount, 300);
  assertEquals(out[2].expected_amount, 0);
});
