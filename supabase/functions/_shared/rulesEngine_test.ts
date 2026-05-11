/**
 * Testes do Motor de Regras (rulesEngine.ts)
 * 
 * Cobertura:
 *   1. Regra de projeto: Especialidade médica não impacta cálculo.
 *   2. Normalização de papéis médicos (aliases: Primeiro Aux, 1º Auxiliar, etc).
 *   3. Matching determinístico por empresa e código.
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

const { classifyDoctorRole } = _test_only;

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

Deno.test("classifyDoctorRole normaliza Cirurgião", () => {
  assertEquals(classifyDoctorRole("Cirurgião Principal"), "cirurgiao");
  assertEquals(classifyDoctorRole("Cirurgiao"), "cirurgiao");
  assertEquals(classifyDoctorRole("Operador"), "cirurgiao");
});

// --- Teste de Fluxo Completo de Importação e Matching ---

Deno.test("analyzePaymentItems realiza matching correto com diferentes nomenclaturas de role", () => {
  const tableId = "table-toracica";
  const code = "30803217";
  
  // Simula o lookup da tabela de referência (o que a Edge Function faz buscando no DB)
  const mockLookup = (tid: string, c: string, role?: string | null) => {
    if (tid !== tableId || c !== code) return null;
    const r = role ? role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : null;
    
    // Na tabela de referência, o papel está como "1º auxiliar" (canonizado no import)
    const values: Record<string, number> = {
      "30803217|1o auxiliar": 5864.39,
      "30803217|primeiro aux": 5864.39, 
      "30803217": 19547.95
    };
    
    return values[`${c}|${r}`] || values[c] || null;
  };

  const rule = makeRule({
    id: "rule-toracica",
    name: "Regra Torácica",
    calculation_type: "tabela_diferenciada",
    reference_table_id: tableId
  });

  const item = makeItem({
    id: "item-salutaire",
    doctor_role: "Primeiro Aux", // Nomenclatura da planilha
    procedure_code: code,
    gross_amount: 5864.39
  });

  const results = analyzePaymentItems([item], [rule], baseCtx, { referenceLookup: mockLookup });
  
  assertEquals(results.length, 1);
  assertEquals(results[0].status, "aprovado");
  assertEquals(results[0].expected_amount, 5864.39);
  assertEquals(results[0].matched_rule_id, "rule-toracica");
});