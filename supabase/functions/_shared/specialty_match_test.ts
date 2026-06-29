/**
 * Testes do match por especialidade em rule_calculations.
 *
 * Política:
 *  - calculation.specialties == [] ou null  → NÃO filtra (comportamento histórico).
 *  - calculation.specialties.length > 0     → filtra: item.specialty deve estar na lista
 *    (comparado por normName). Item sem specialty → não casa.
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  reference_date: "2026-05-06",
};

function rule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: "r-consultas-df-star",
    name: "Consultas DF Star",
    rule_text: "Valor fixo por especialidade",
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
    calculation_type: "valor_fixo",
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
    procedure_code: "10101012", // consulta médica
    procedure_name: "Consulta",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião",
    procedure_amount: 100,
    gross_amount: 100,
    attendance_number: "1",
    patient_name: "P",
    procedure_date: "2026-05-06T10:00:00",
    quantity: 1,
    agreement_name: null,
    specialty: null,
    ...overrides,
  } as ItemInput;
}

// Regra-tipo "tabela de consultas por especialidade" — 3 cálculos com specialties[] + fallback.
const consultasRule = rule({
  calculations: [
    {
      id: "cardio",
      sort_order: 0,
      label: "Cardiologia",
      calculation_type: "valor_fixo",
      fixed_amount: 250,
      specialties: ["Cardiologia"], match_by_specialty: true,
      code_match_mode: "any",
    },
    {
      id: "pediatria",
      sort_order: 1,
      label: "Pediatria",
      calculation_type: "valor_fixo",
      fixed_amount: 180,
      specialties: ["Pediatria"], match_by_specialty: true,
      code_match_mode: "any",
    },
    {
      id: "ortopedia",
      sort_order: 2,
      label: "Ortopedia / Traumato",
      calculation_type: "valor_fixo",
      fixed_amount: 220,
      specialties: ["Ortopedia", "Traumatologia"], match_by_specialty: true,
      code_match_mode: "any",
    },
  ],
} as any);

Deno.test("Specialty match — Cardiologia cai no cálculo correto (R$ 250)", () => {
  const r = analyzePaymentItems(
    [item({ specialty: "Cardiologia" })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, 250);
});

Deno.test("Specialty match — Pediatria cai no cálculo correto (R$ 180)", () => {
  const r = analyzePaymentItems(
    [item({ specialty: "Pediatria" })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, 180);
});

Deno.test("Specialty match — múltiplas especialidades por cálculo (Traumatologia → Ortopedia)", () => {
  const r = analyzePaymentItems(
    [item({ specialty: "Traumatologia" })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, 220);
});

Deno.test("Specialty match — normalização (acento/caixa) — 'cardiología' casa 'Cardiologia'", () => {
  const r = analyzePaymentItems(
    [item({ specialty: "cardiología" })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, 250);
});

Deno.test("Specialty match — especialidade não listada não casa nenhum cálculo (sem_regra)", () => {
  const r = analyzePaymentItems(
    [item({ specialty: "Dermatologia" })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, null);
});

Deno.test("Specialty match — item sem specialty informada não casa quando o cálculo exige", () => {
  const r = analyzePaymentItems(
    [item({ specialty: null })],
    [consultasRule],
    baseCtx,
  );
  assertEquals(r[0].expected_amount, null);
});

// ---------- Comportamento histórico: specialties vazio = sem filtro ----------

Deno.test("Histórico — calculation.specialties=[] NÃO filtra: aceita qualquer especialidade", () => {
  const r = rule({
    calculations: [
      {
        id: "geral",
        sort_order: 0,
        label: "Geral (sem filtro de esp.)",
        calculation_type: "valor_fixo",
        fixed_amount: 99,
        specialties: [],
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems(
    [
      item({ id: "a", specialty: "Cardiologia" }),
      item({ id: "b", specialty: "Dermatologia" }),
      item({ id: "c", specialty: null }),
    ],
    [r],
    baseCtx,
  );
  assertEquals(out[0].expected_amount, 99);
  assertEquals(out[1].expected_amount, 99);
  assertEquals(out[2].expected_amount, 99);
});

Deno.test("Histórico — calculation.specialties=null NÃO filtra (compatível com regras antigas)", () => {
  const r = rule({
    calculations: [
      {
        id: "legacy",
        sort_order: 0,
        label: "Legado",
        calculation_type: "valor_fixo",
        fixed_amount: 77,
        // specialties intencionalmente ausente / null
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems(
    [item({ specialty: "QualquerCoisa" }), item({ id: "b", specialty: null })],
    [r],
    baseCtx,
  );
  assertEquals(out[0].expected_amount, 77);
  assertEquals(out[1].expected_amount, 77);
});

Deno.test("Toggle desligado — specialties[] preenchido mas match_by_specialty=false NÃO filtra", () => {
  const r = rule({
    calculations: [
      {
        id: "cardio-off",
        sort_order: 0,
        label: "Cardio (toggle off)",
        calculation_type: "valor_fixo",
        fixed_amount: 88,
        specialties: ["Cardiologia"],
        match_by_specialty: false, // explicitamente desligado
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems(
    [item({ specialty: "Dermatologia" }), item({ id: "b", specialty: null })],
    [r],
    baseCtx,
  );
  // Toggle off → ignora specialties[] e aceita qualquer item.
  assertEquals(out[0].expected_amount, 88);
  assertEquals(out[1].expected_amount, 88);
});



Deno.test("Histórico — rule.specialties no nível Regra é só informativo (não filtra)", () => {
  const r = rule({
    specialties: ["Cardiologia"], // nível regra — não deve impactar match
    calculations: [
      {
        id: "geral",
        sort_order: 0,
        label: "Geral",
        calculation_type: "valor_fixo",
        fixed_amount: 55,
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems(
    [item({ specialty: "Dermatologia" })],
    [r],
    baseCtx,
  );
  // Mesmo com especialidade "incompatível" no nível regra, o cálculo aceita.
  assertEquals(out[0].expected_amount, 55);
});

// ---------- Coexistência: cálculo com specialties[] + fallback sem ----------

Deno.test("Coexistência — cálculo com specialties[] tem prioridade; fallback sem filtro pega o resto", () => {
  const r = rule({
    calculations: [
      {
        id: "cardio",
        sort_order: 0,
        label: "Cardiologia",
        calculation_type: "valor_fixo",
        fixed_amount: 300,
        specialties: ["Cardiologia"], match_by_specialty: true,
        code_match_mode: "any",
      },
      {
        id: "fallback",
        sort_order: 1,
        label: "Demais especialidades",
        calculation_type: "valor_fixo",
        fixed_amount: 120,
        code_match_mode: "any",
      },
    ],
  } as any);
  const out = analyzePaymentItems(
    [
      item({ id: "a", specialty: "Cardiologia" }),
      item({ id: "b", specialty: "Dermatologia" }),
      item({ id: "c", specialty: null }),
    ],
    [r],
    baseCtx,
  );
  assertEquals(out[0].expected_amount, 300);
  assertEquals(out[1].expected_amount, 120);
  assertEquals(out[2].expected_amount, 120);
});

Deno.test("Trace — motivo de descarte inclui 'especialidade' quando filtro de cálculo rejeita", () => {
  const out = analyzePaymentItems(
    [item({ specialty: "Dermatologia" })],
    [consultasRule],
    baseCtx,
  );
  const traceStr = JSON.stringify(out[0]);
  assert(
    /especialidade/i.test(traceStr),
    "esperava motivo de descarte mencionando 'especialidade' no trace/resultado",
  );
});
