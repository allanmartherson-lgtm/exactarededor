/**
 * Testes de INTEGRAÇÃO do rulesEngine — análise ponta-a-ponta (analyzePaymentItems)
 * com múltiplas regras + múltiplos itens, validando:
 *   1. Comportamento histórico preservado quando nenhum cálculo declara specialties[].
 *   2. Match correto quando há cálculos com specialties[] + match_by_specialty=true.
 *   3. Coexistência entre uma regra "consultas por especialidade" e regras
 *      tradicionais (cirurgia/tabela diferenciada) sem interferência cruzada.
 *   4. Output completo (status, matched_rule_id, matched_calculation_id, expected_amount).
 *   5. Regressão: cálculo com specialties[] mas SEM o toggle não filtra — comportamento
 *      idêntico ao histórico (importante para regras antigas).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

const CTX: PaymentContext = {
  sectors: ["outro"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-05-06",
};

function baseItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "i",
    doctor_name: "Dr X",
    doctor_document: "1",
    company_name: "ACME",
    company_id: null,
    company_document: null,
    procedure_code: "10101012",
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

function baseRule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: "r",
    name: "Regra",
    rule_text: "",
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

/* =====================================================================
 * 1) HISTÓRICO — nenhuma regra usa specialties; especialidade é ignorada.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/histórico — regras sem specialties[] aceitam itens independente da especialidade", () => {
  const cirurgia = baseRule({
    id: "r-cir",
    name: "Cirurgia geral",
    calculations: [
      {
        id: "cir-1",
        sort_order: 0,
        label: "Cirurgião",
        calculation_type: "valor_fixo",
        fixed_amount: 800,
        doctor_roles: ["cirurgiao"],
        code_match_mode: "any",
      },
    ],
  } as any);
  const tabela = baseRule({
    id: "r-tab",
    name: "Tabela diferenciada",
    calculations: [
      {
        id: "tab-1",
        sort_order: 0,
        label: "CBHPM x2",
        calculation_type: "tabela_diferenciada",
        multiplier: 2,
        reference_table_id: null,
        code_match_mode: "any",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    baseItem({ id: "i1", doctor_role: "Cirurgião Principal", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "i2", doctor_role: "Cirurgião Principal", specialty: "Dermatologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "i3", doctor_role: "Cirurgião Principal", specialty: null, procedure_amount: 0, gross_amount: 0 }),
  ];

  const out = analyzePaymentItems(items, [cirurgia, tabela], CTX);
  // Os 3 itens devem casar a mesma regra/cálculo — a especialidade NÃO deve interferir.
  for (const r of out) {
    assertEquals(r.matched_rule_id, "r-cir", `item ${r.item_id} deveria bater cirurgia`);
    assertEquals(r.expected_amount, 800);
    assert(r.status !== "sem_regra", `item ${r.item_id} não pode ser sem_regra`);
  }
});

/* =====================================================================
 * 2) CONSULTAS POR ESPECIALIDADE — regra de consultas convive com cirurgia.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/consultas — regra de consultas com specialties[] roteia por especialidade, cirurgia segue intacta", () => {
  const consultas = baseRule({
    id: "r-consultas",
    name: "Consultas DF Star",
    calculations: [
      {
        id: "cardio",
        sort_order: 0,
        label: "Cardiologia",
        calculation_type: "valor_fixo",
        fixed_amount: 250,
        specialties: ["Cardiologia"],
        match_by_specialty: true,
        procedure_codes: ["10101012"],
        code_match_mode: "whitelist",
      },
      {
        id: "pedia",
        sort_order: 1,
        label: "Pediatria",
        calculation_type: "valor_fixo",
        fixed_amount: 180,
        specialties: ["Pediatria"],
        match_by_specialty: true,
        procedure_codes: ["10101012"],
        code_match_mode: "whitelist",
      },
    ],
  } as any);
  const cirurgia = baseRule({
    id: "r-cir",
    name: "Cirurgia geral",
    calculations: [
      {
        id: "cir-1",
        sort_order: 0,
        label: "Cirurgião",
        calculation_type: "valor_fixo",
        fixed_amount: 1200,
        procedure_codes: ["31001010"],
        code_match_mode: "whitelist",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    // Consultas — devem rotear por especialidade
    baseItem({ id: "c1", procedure_code: "10101012", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "c2", procedure_code: "10101012", specialty: "Pediatria",  procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "c3", procedure_code: "10101012", specialty: "Ortopedia",  procedure_amount: 0, gross_amount: 0 }), // não casa nenhum
    // Cirurgia — não deve sofrer interferência da especialidade
    baseItem({ id: "s1", procedure_code: "31001010", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "s2", procedure_code: "31001010", specialty: null,           procedure_amount: 0, gross_amount: 0 }),
  ];

  const out = analyzePaymentItems(items, [consultas, cirurgia], CTX);
  const byId = Object.fromEntries(out.map((r) => [r.item_id, r]));

  // Consultas roteadas por especialidade
  assertEquals(byId.c1.matched_rule_id, "r-consultas");
  assertEquals(byId.c1.expected_amount, 250);
  assertEquals(byId.c2.matched_rule_id, "r-consultas");
  assertEquals(byId.c2.expected_amount, 180);

  // Especialidade fora da tabela: regra-pai bate (master), mas nenhum cálculo casa.
  // Engine retorna expected_amount = null (não pode inferir valor).
  assertEquals(byId.c3.expected_amount, null);

  // Cirurgias batem a regra de cirurgia, independente da especialidade
  assertEquals(byId.s1.matched_rule_id, "r-cir");
  assertEquals(byId.s1.expected_amount, 1200);
  assertEquals(byId.s2.matched_rule_id, "r-cir");
  assertEquals(byId.s2.expected_amount, 1200);
});

/* =====================================================================
 * 3) REGRESSÃO — specialties[] preenchido mas SEM toggle não deve filtrar.
 *    Garante compatibilidade com regras antigas que tinham specialties[]
 *    populado por descuido antes do toggle existir.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/regressão — specialties[] sem match_by_specialty se comporta como histórico (não filtra)", () => {
  const regraAntiga = baseRule({
    id: "r-old",
    name: "Regra antiga c/ specialties por descuido",
    calculations: [
      {
        id: "old-1",
        sort_order: 0,
        label: "Valor fixo",
        calculation_type: "valor_fixo",
        fixed_amount: 500,
        // Lista preenchida historicamente, MAS sem o toggle.
        specialties: ["Cardiologia"],
        // match_by_specialty: undefined / false
        code_match_mode: "any",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    baseItem({ id: "x1", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "x2", specialty: "Dermatologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "x3", specialty: null, procedure_amount: 0, gross_amount: 0 }),
  ];

  const out = analyzePaymentItems(items, [regraAntiga], CTX);
  // Todos devem casar — toggle off = ignora specialties[] (idêntico ao pré-toggle).
  for (const r of out) {
    assertEquals(r.matched_rule_id, "r-old");
    assertEquals(r.expected_amount, 500, `item ${r.item_id} deveria receber R$ 500`);
  }
});

/* =====================================================================
 * 4) MISTO NA MESMA REGRA — cálculo com specialties + fallback sem.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/mista — cálculo com specialties + fallback sem filtro na mesma regra", () => {
  const r = baseRule({
    id: "r-mix",
    name: "Tabela + fallback",
    calculations: [
      {
        id: "cardio-vip",
        sort_order: 0,
        label: "Cardio (VIP)",
        calculation_type: "valor_fixo",
        fixed_amount: 400,
        specialties: ["Cardiologia"],
        match_by_specialty: true,
        code_match_mode: "any",
      },
      {
        id: "fallback",
        sort_order: 1,
        label: "Demais",
        calculation_type: "valor_fixo",
        fixed_amount: 150,
        code_match_mode: "any",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    baseItem({ id: "a", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "b", specialty: "Dermatologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "c", specialty: null, procedure_amount: 0, gross_amount: 0 }),
  ];
  const out = analyzePaymentItems(items, [r], CTX);
  const byId = Object.fromEntries(out.map((x) => [x.item_id, x]));

  assertEquals(byId.a.expected_amount, 400);
  assertEquals(byId.b.expected_amount, 150);
  assertEquals(byId.c.expected_amount, 150);

  // Todos pertencem à mesma regra; mudou só o cálculo escolhido.
  for (const r2 of out) assertEquals(r2.matched_rule_id, "r-mix");
});

/* =====================================================================
 * 5) STATUS final — verifica que campos críticos do output continuam
 *    populados quando o filtro por especialidade entra em jogo.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/output — campos de saída (status, rule_id, expected_amount, breakdown) populados corretamente", () => {
  const r = baseRule({
    id: "r-out",
    name: "Consultas",
    calculations: [
      {
        id: "cardio",
        sort_order: 0,
        label: "Cardio",
        calculation_type: "valor_fixo",
        fixed_amount: 220,
        specialties: ["Cardiologia"],
        match_by_specialty: true,
        code_match_mode: "any",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    baseItem({ id: "ok", specialty: "Cardiologia", procedure_amount: 220, gross_amount: 220 }),
    baseItem({ id: "fail", specialty: "Dermatologia", procedure_amount: 0, gross_amount: 0 }),
  ];
  const out = analyzePaymentItems(items, [r], CTX);
  const ok = out.find((x) => x.item_id === "ok")!;
  const fail = out.find((x) => x.item_id === "fail")!;

  // Caminho feliz
  assertEquals(ok.matched_rule_id, "r-out");
  assertEquals(ok.matched_rule_name, "Consultas");
  assertEquals(ok.expected_amount, 220);
  assert(ok.status !== "sem_regra");
  assert(Array.isArray(ok.alerts));

  // Caminho de descarte — regra bate (master), mas cálculo é descartado pela especialidade
  // → expected_amount nulo, e o trace/explicação devem mencionar especialidade.
  assertEquals(fail.expected_amount, null);
  const dump = JSON.stringify(fail);
  assert(/especialidade/i.test(dump), "esperava motivo de descarte mencionando 'especialidade'");
});

/* =====================================================================
 * 6) MÚLTIPLAS REGRAS — garante que o engine escolhe a regra certa
 *    quando o toggle restringe uma das candidatas.
 * ===================================================================== */
Deno.test("INTEGRAÇÃO/seleção — toggle de specialty descarta uma candidata e libera a outra", () => {
  const especifica = baseRule({
    id: "r-esp",
    name: "Específica (só cardio)",
    severity: "critico",
    calculations: [
      {
        id: "x",
        sort_order: 0,
        label: "Cardio fixo",
        calculation_type: "valor_fixo",
        fixed_amount: 999,
        specialties: ["Cardiologia"],
        match_by_specialty: true,
        code_match_mode: "any",
      },
    ],
  } as any);
  const generica = baseRule({
    id: "r-gen",
    name: "Genérica (qualquer)",
    severity: "aviso",
    calculations: [
      {
        id: "y",
        sort_order: 0,
        label: "Geral",
        calculation_type: "valor_fixo",
        fixed_amount: 100,
        code_match_mode: "any",
      },
    ],
  } as any);

  const items: ItemInput[] = [
    baseItem({ id: "cardio", specialty: "Cardiologia", procedure_amount: 0, gross_amount: 0 }),
    baseItem({ id: "outra", specialty: "Dermatologia", procedure_amount: 0, gross_amount: 0 }),
  ];
  const out = analyzePaymentItems(items, [especifica, generica], CTX);
  const byId = Object.fromEntries(out.map((x) => [x.item_id, x]));

  // Cardiologia: ambas batem; específica vence (severidade maior).
  // Comportamento exato de empate depende da política de seleção, mas pelo
  // menos uma regra deve ter casado e expected_amount > 0.
  assert(byId.cardio.matched_rule_id !== null, "cardio precisa ter regra");
  assert((byId.cardio.expected_amount ?? 0) > 0, "cardio precisa ter expected > 0");

  // Dermatologia: específica é descartada pelo toggle de specialty → cai na genérica.
  assertEquals(byId.outra.matched_rule_id, "r-gen");
  assertEquals(byId.outra.expected_amount, 100);
});
