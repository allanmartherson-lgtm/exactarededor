/**
 * Sub-Onda 2A — Teste do mapeamento 13 → 8 (espelho do CHECK constraint
 * applied_calc_method_valid em payment_items) e da derivação dos campos
 * que serão gravados nas colunas SQL nativas a partir de AnalysisResult.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";
import {
  APPLIED_CALC_METHOD_VALUES,
  mapCalculationTypeToMethod,
} from "./calcMethodMapping.ts";

Deno.test("ONDA 2A — mapeamento colapsa 4 sabores de pacote em 'pacote'", () => {
  assertEquals(mapCalculationTypeToMethod("pacote"), "pacote");
  assertEquals(mapCalculationTypeToMethod("pacote_fechado"), "pacote");
  assertEquals(mapCalculationTypeToMethod("pacote_com_extras"), "pacote");
  assertEquals(mapCalculationTypeToMethod("pacote_por_atendimento"), "pacote");
  assertEquals(mapCalculationTypeToMethod("pacote_fixo"), "pacote");
});

Deno.test("ONDA 2A — mapeamento colapsa tabela_referencia em tabela_diferenciada", () => {
  assertEquals(mapCalculationTypeToMethod("tabela_diferenciada"), "tabela_diferenciada");
  assertEquals(mapCalculationTypeToMethod("tabela_referencia"), "tabela_diferenciada");
});

Deno.test("ONDA 2A — informativo / default_* / null / desconhecido viram null", () => {
  assertEquals(mapCalculationTypeToMethod("informativo"), null);
  assertEquals(mapCalculationTypeToMethod("default_geral"), null);
  assertEquals(mapCalculationTypeToMethod("default_hemodinamica"), null);
  assertEquals(mapCalculationTypeToMethod(null), null);
  assertEquals(mapCalculationTypeToMethod(undefined), null);
  assertEquals(mapCalculationTypeToMethod("metodo_inexistente_qualquer"), null);
});

Deno.test("ONDA 2A — outros métodos preservam mapeamento 1:1", () => {
  assertEquals(mapCalculationTypeToMethod("percentual_sobre_convenio"), "percentual_convenio");
  assertEquals(mapCalculationTypeToMethod("regra_vias"), "regra_vias");
  assertEquals(mapCalculationTypeToMethod("valor_fixo"), "valor_fixo");
  assertEquals(mapCalculationTypeToMethod("bonus"), "bonus");
  assertEquals(mapCalculationTypeToMethod("complemento"), "complemento");
  assertEquals(mapCalculationTypeToMethod("exclusao"), "exclusao");
});

Deno.test("ONDA 2A — todos os valores do mapeamento estão na lista dos 8 permitidos pelo CHECK", () => {
  const inputs = [
    "pacote","pacote_fechado","pacote_com_extras","pacote_por_atendimento","pacote_fixo",
    "tabela_diferenciada","tabela_referencia",
    "percentual_sobre_convenio","regra_vias","valor_fixo","bonus","complemento","exclusao",
  ];
  for (const i of inputs) {
    const m = mapCalculationTypeToMethod(i);
    assert(m !== null, `${i} deveria mapear para algum valor`);
    assert(
      APPLIED_CALC_METHOD_VALUES.includes(m!),
      `${i} mapeou para ${m}, fora dos 8 valores aceitos pelo CHECK`,
    );
  }
});

// --- Teste 1 — item novo passa pelo motor e produz dados suficientes para
// gravar TODAS as colunas estruturadas (applied_rule_id, applied_rule_label,
// applied_calc_id, applied_calc_method, expected_amount). ---

Deno.test("ONDA 2A — item novo: AnalysisResult contém os 5 campos para gravar colunas SQL nativas", () => {
  const tableId = "table-2a";
  const code = "30715091";
  const lookup = (tid: string, c: string, _role?: string | null, roleSpecific?: boolean) => {
    if (tid !== tableId || c !== code) return null;
    if (roleSpecific === true) return null;
    return 1000;
  };

  const rule: RuleInput = {
    id: "rule-2a",
    name: "Regra Sub-Onda 2A",
    rule_text: "TD via calculations[]",
    description: null,
    active: true,
    severity: "aviso",
    scope: "especifica",
    sector: "outro",
    sectors: ["outro"],
    specialties: null,
    target_type: "empresa",
    target_identifier: "12345678000199",
    target_name: "ACME",
    target_company_id: "company-1",
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "tabela_diferenciada",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        id: "calc-2a-uuid",
        sort_order: 0,
        label: "TD principal",
        calculation_type: "tabela_diferenciada",
        reference_table_id: tableId,
        multiplier: 1,
      },
    ],
  } as RuleInput;

  const item: ItemInput = {
    id: "item-2a",
    doctor_name: "Dra. X",
    doctor_document: "111",
    company_name: "ACME",
    company_id: "company-1",
    company_document: "12345678000199",
    procedure_code: code,
    procedure_name: "P",
    description: null,
    access_route: "Única ou principal",
    doctor_role: "Cirurgião Principal",
    procedure_amount: 1000,
    gross_amount: 1000,
    attendance_number: "1",
    patient_name: "P",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: null,
    specialty: null,
  } as ItemInput;

  const ctx: PaymentContext = {
    sectors: ["outro"],
    specialties: [],
    payment_type: null,
    reference_date: "2026-05-01",
  };

  const [r] = analyzePaymentItems([item], [rule], ctx, { referenceLookup: lookup });

  // Os 5 campos que serão escritos nas colunas SQL:
  assertEquals(r.matched_rule_id, "rule-2a", "applied_rule_id virá daqui");
  assertEquals(r.matched_rule_name, "Regra Sub-Onda 2A", "applied_rule_label virá daqui");
  assertEquals(r.expected_amount, 1000, "expected_amount virá daqui");

  // applied_calc_method é derivado por mapCalculationTypeToMethod(calculation_type_used)
  assertEquals(r.calculation_type_used, "tabela_diferenciada");
  assertEquals(mapCalculationTypeToMethod(r.calculation_type_used), "tabela_diferenciada");

  // applied_calc_id é o calc_id do primeiro item de cálculo casado em calculation_breakdown.
  assert(Array.isArray(r.calculation_breakdown), "deve haver calculation_breakdown");
  const matched = r.calculation_breakdown!.find((b) => b.matched && b.calc_id);
  assert(matched, "deve haver pelo menos 1 calc casado com calc_id");
  assertEquals(matched!.calc_id, "calc-2a-uuid", "applied_calc_id virá daqui");
});
