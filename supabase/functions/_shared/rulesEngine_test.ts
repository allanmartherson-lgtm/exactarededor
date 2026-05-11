/**
 * Testes do Motor de Regras (rulesEngine.ts)
 * 
 * Cobertura:
 *   1. Regra de projeto: Especialidade médica não impacta cálculo.
 *   2. Normalização de papéis médicos (aliases: Primeiro Aux, 1º Auxiliar, etc).
 *   3. Matching determinístico por empresa e código.
 *   4. Resiliência a variações de espaços e acentos em nomes/convênios.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  preFilterRules,
  selectWinningRule,
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
  _test_only
} from "./rulesEngine.ts";

const { classifyDoctorRole, normAgreement, normName, normAccessRoute } = _test_only;


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
  specialties: ["Ginecologia"],
  payment_type: null,
  reference_date: "2026-05-01",
};

// --- Testes de Especialidade (Regra de Projeto) ---

Deno.test("preFilterRules NÃO descarta regra cuja specialties não bate com ctx.specialties", () => {
  const rule = makeRule({ specialties: ["Ortopedia", "Pediatria"] });
  const out = preFilterRules([rule], baseCtx);
  assertEquals(out.length, 1);
});

Deno.test("selectWinningRule escolhe regra mesmo quando item.specialty difere de rule.specialties", () => {
  const rule = makeRule({ specialties: ["Ortopedia"] });
  const item = makeItem({ specialty: "Cardiologia" });
  const outcome = selectWinningRule(item, [rule]);
  assert(outcome);
  assertEquals(outcome!.rule?.id, rule.id);
});

// --- Testes de Normalização de Roles (Médicos) ---

Deno.test("classifyDoctorRole normaliza variações de Primeiro Auxiliar", () => {
  assertEquals(classifyDoctorRole("Primeiro Auxiliar"), "primeiro_aux");
  assertEquals(classifyDoctorRole("1º Auxiliar"), "primeiro_aux");
  assertEquals(classifyDoctorRole("1o Auxiliar"), "primeiro_aux");
  assertEquals(classifyDoctorRole("Primeiro Aux"), "primeiro_aux");
  assertEquals(classifyDoctorRole("1.º Auxiliar"), "primeiro_aux");
  assertEquals(classifyDoctorRole("Auxiliar 1"), "primeiro_aux");
});

Deno.test("classifyDoctorRole normaliza variações de Segundo Auxiliar", () => {
  assertEquals(classifyDoctorRole("Segundo Auxiliar"), "demais_aux");
  assertEquals(classifyDoctorRole("2º Auxiliar"), "demais_aux");
  assertEquals(classifyDoctorRole("2o Auxiliar"), "demais_aux");
  assertEquals(classifyDoctorRole("Segundo Aux"), "demais_aux");
  assertEquals(classifyDoctorRole("Auxiliar 2"), "demais_aux");
});

Deno.test("classifyDoctorRole normaliza variações de Terceiro Auxiliar", () => {
  assertEquals(classifyDoctorRole("Terceiro Auxiliar"), "demais_aux");
  assertEquals(classifyDoctorRole("3º Auxiliar"), "demais_aux");
});

Deno.test("classifyDoctorRole normaliza Cirurgião", () => {
  assertEquals(classifyDoctorRole("Cirurgião Principal"), "cirurgiao");
  assertEquals(classifyDoctorRole("Cirurgiao"), "cirurgiao");
  assertEquals(classifyDoctorRole("Operador"), "cirurgiao");
});

// --- Testes de Normalização de Nomes e Convênios (Acentos e Espaços) ---

Deno.test("normName e normAgreement lidam com acentos e espaços", () => {
  assertEquals(normName("João Müller "), "joao muller");
  assertEquals(normAgreement(" Bradesco Saúde  "), "bradescosaude");
  assertEquals(normAgreement("SUL AMÉRICA"), "sulamerica");
});

Deno.test("normAccessRoute normaliza variações de Via de Acesso", () => {
  assertEquals(normAccessRoute("Única ou principal"), "unica_principal");
  assertEquals(normAccessRoute("unica/principal"), "unica_principal");
  assertEquals(normAccessRoute("1ª via"), "unica_principal");
  assertEquals(normAccessRoute("1 via"), "unica_principal");
  assertEquals(normAccessRoute("Principal"), "unica_principal");
  assertEquals(normAccessRoute("Mesma via"), "mesma_via");
  assertEquals(normAccessRoute("Outra via"), "outra_via");
});


// --- Teste de Fluxo Completo de Importação e Matching ---

Deno.test("analyzePaymentItems realiza matching correto com diferentes nomenclaturas e normalizações", () => {
  const tableId = "table-toracica";
  const code = "30803217";
  
  const mockLookup = (tid: string, c: string, role?: string | null) => {
    if (tid !== tableId || c !== code) return null;
    const classified = classifyDoctorRole(role);
    if (classified === "primeiro_aux") return 5864.39;
    if (classified === "cirurgiao") return 19547.95;
    return null;
  };

  const rule = makeRule({
    id: "rule-toracica",
    name: "Regra Torácica",
    calculation_type: "tabela_diferenciada",
    reference_table_id: tableId,
    agreement_aliases: ["Bradesco Saude"], // Sem acento na regra
    agreement_match_mode: "whitelist"
  });

  // Caso 1: Primeiro Aux (como no Salutaire) + Convênio com acento
  const item1 = makeItem({
    id: "item-1",
    doctor_role: "Primeiro Aux",
    procedure_code: code,
    gross_amount: 5864.39,
    agreement_name: "Bradesco Saúde"
  });

  // Caso 2: 1º Auxiliar (canônico) + Convênio com espaços extras
  const item2 = makeItem({
    id: "item-2",
    doctor_role: "1º Auxiliar",
    procedure_code: code,
    gross_amount: 5864.39,
    agreement_name: "  Bradesco Saude  "
  });

  // Caso 3: Nome do médico com acento na regra mas sem no item (ou vice-versa)
  const ruleDoc = makeRule({
    id: "rule-doctor",
    scope: "especifica",
    target_type: "medico",
    target_name: "João Müller",
    convenio_percentage: 88
  });
  const item3 = makeItem({
    id: "item-3",
    doctor_name: "Joao Muller",
    gross_amount: 88,
    procedure_amount: 100
  });

  const results = analyzePaymentItems([item1, item2, item3], [rule, ruleDoc], baseCtx, { referenceLookup: mockLookup });
  
  assertEquals(results.length, 3);
  
  // Verificações dos itens Salutaire
  assertEquals(results[0].expected_amount, 5864.39);
  assertEquals(results[0].matched_rule_id, "rule-toracica");
  assertEquals(results[1].expected_amount, 5864.39);
  assertEquals(results[1].matched_rule_id, "rule-toracica");
  
  // Verificação de normalização de nome de médico
  assertEquals(results[2].matched_rule_id, "rule-doctor");
  assertEquals(results[2].expected_amount, 88);
});
