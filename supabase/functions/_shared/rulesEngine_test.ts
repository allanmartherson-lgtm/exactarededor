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
  _test_only,
  calcTabelaDiferenciadaForTest,
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
  assertEquals(normAccessRoute("1a via"), "unica_principal");
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

// --- Teste de Sequência de Itens de Cálculo (Cálculo 1 → Cálculo 2 por Via) ---

Deno.test("applyCalculation respeita sort_order e usa Cálculo 2 quando Via Principal não casa", () => {
  const rule = makeRule({
    calculation_type: "percentual_sobre_convenio",
    calculations: [
      {
        id: "c1",
        sort_order: 0,
        label: "Via Principal — fixo",
        calculation_type: "valor_fixo",
        fixed_amount: 4000,
        allowed_access_routes: ["Única ou principal"],
      },
      {
        id: "c2",
        sort_order: 1,
        label: "Vias Secundárias — 100% convênio",
        calculation_type: "percentual_sobre_convenio",
        convenio_percentage: 100,
        allowed_access_routes: ["Mesma Via", "Outra Via"],
      },
    ],
  });

  const itemPrincipal = makeItem({ id: "p", access_route: "Única ou principal", gross_amount: 1234, procedure_amount: 1234 });
  const r1 = analyzePaymentItems([itemPrincipal], [rule], baseCtx);
  assertEquals(r1[0].expected_amount, 4000);

  const itemMesma = makeItem({ id: "m", access_route: "Mesma via de acesso", gross_amount: 1234, procedure_amount: 1234 });
  const r2 = analyzePaymentItems([itemMesma], [rule], baseCtx);
  assertEquals(r2[0].expected_amount, 1234);

  const itemOutra = makeItem({ id: "o", access_route: "Via de acesso diferente", gross_amount: 800, procedure_amount: 800 });
  const r3 = analyzePaymentItems([itemOutra], [rule], baseCtx);
  assertEquals(r3[0].expected_amount, 800);
});

Deno.test("applyCalculation ordena calculations defensivamente por sort_order mesmo se a fonte vier embaralhada", () => {
  const rule = makeRule({
    calculations: [
      {
        id: "c2",
        sort_order: 1,
        label: "Secundárias",
        calculation_type: "percentual_sobre_convenio",
        convenio_percentage: 100,
        allowed_access_routes: ["Mesma Via", "Outra Via"],
      },
      {
        id: "c1",
        sort_order: 0,
        label: "Principal fixo",
        calculation_type: "valor_fixo",
        fixed_amount: 4000,
        allowed_access_routes: ["Única ou principal"],
      },
    ],
  });
  const item = makeItem({ access_route: "Única ou principal", procedure_amount: 100 });
  const r = analyzePaymentItems([item], [rule], baseCtx);
  assertEquals(r[0].expected_amount, 4000);
});


// --- ONDA 1 — Correção 1: Vigência por procedure_date (regra de competência) ---

Deno.test("ONDA 1 — vigência da regra é determinada pela procedure_date do item, não pela data do lote", () => {
  const ruleA = makeRule({
    id: "rule-A",
    name: "Regra A (vigência 2026-01-01 → 2026-03-31)",
    valid_from: "2026-01-01",
    valid_until: "2026-03-31",
    convenio_percentage: 80,
  });
  const ruleB = makeRule({
    id: "rule-B",
    name: "Regra B (vigência 2026-04-01 → null)",
    valid_from: "2026-04-01",
    valid_until: null,
    convenio_percentage: 95,
  });

  // Lote tem due_date em 2026-05-01 (Regra B vigente nessa data),
  // mas o procedimento foi realizado em 2026-02-15 (Regra A vigente).
  const item = makeItem({
    id: "item-comp",
    procedure_date: "2026-02-15",
    procedure_amount: 100,
    gross_amount: 80,
  });

  const ctxLote: PaymentContext = {
    sectors: ["outro"],
    specialties: [],
    payment_type: null,
    reference_date: "2026-05-01", // data do lote — NÃO deve influenciar
  };

  const results = analyzePaymentItems([item], [ruleA, ruleB], ctxLote);
  assertEquals(results.length, 1);
  assertEquals(
    results[0].matched_rule_id,
    "rule-A",
    "Deve aplicar Regra A (vigente em 2026-02-15), não Regra B (data do lote)",
  );
  assertEquals(results[0].expected_amount, 80);
});

// --- ONDA 1 — Correção 2: Ordem fiscal e arredondamento por etapa na Tabela Diferenciada ---

Deno.test("ONDA 1 — Tabela Diferenciada: ordem (base→mult→repasse→via→função→qtd→deflator) com arredondamento por etapa", () => {
  const tableId = "table-onda1";
  const code = "99999999";
  // Lookup: retorna 100 SEMPRE que NÃO for a chamada role-specific (4º arg true);
  // a chamada role-specific retorna null para garantir que NÃO seja considerado
  // "valor específico para o papel" (e o % de função seja aplicado).
  const lookup = (tid: string, c: string, _role?: string | null, roleSpecific?: boolean) => {
    if (tid !== tableId || c !== code) return null;
    if (roleSpecific === true) return null;
    return 100;
  };

  const rule = makeRule({
    id: "rule-onda1-td",
    name: "Tabela Diferenciada — Onda 1",
    calculation_type: "tabela_diferenciada",
    reference_table_id: tableId,
    multiplier: 1.5,
    repasse_pct: 80,
    apply_access_route: true,
    include_auxiliaries: true,
    aux_first_pct: 30,
    deflator_pct: 5,
  });

  const item = makeItem({
    id: "item-onda1-td",
    procedure_code: code,
    doctor_role: "1º Auxiliar",
    access_route: "Via de acesso diferente", // accessRouteFactor → 0.7
    quantity: 2,
    procedure_amount: 100,
    gross_amount: 0,
  });

  // Acesso direto ao calculador para validar steps com arredondamento por etapa.
  const calc = (calcTabelaDiferenciadaForTest as any)(rule, item, lookup);
  const steps: { label: string; value: number }[] = calc.steps;

  // 1) base                                 = 100,00
  assertEquals(steps.find((s) => s.label === "base")!.value, 100.00);
  // 2) × 1,5                                = 150,00
  assertEquals(steps.find((s) => s.label === "multiplicador")!.value, 150.00);
  // 3) × 80%  (repasse antes da via)        = 120,00
  assertEquals(steps.find((s) => s.label === "repasse")!.value, 120.00);
  // 4) × 70%  (via antes da função)         =  84,00
  assertEquals(steps.find((s) => s.label === "via_acesso")!.value, 84.00);
  // 5) × 30%  (função 1º aux)               =  25,20
  assertEquals(steps.find((s) => s.label === "funcao")!.value, 25.20);
  // 6) × 2    (quantidade dentro da TD)     =  50,40
  assertEquals(steps.find((s) => s.label === "quantidade")!.value, 50.40);
  // 7) × (1 − 0,05)                          =  47,88
  assertEquals(steps.find((s) => s.label === "deflator")!.value, 47.88);

  assertEquals(calc.expected, 47.88);
  assertEquals(calc.qty_already_applied, true);

  // Sanity-check via fluxo público: finalizeAnalysis NÃO deve multiplicar qtd de novo.
  const results = analyzePaymentItems([item], [rule], baseCtx, { referenceLookup: lookup });
  assertEquals(results[0].expected_amount, 47.88);
});

// --- ONDA 1 BUGFIX — Tabela Diferenciada via rule.calculations[] não duplica quantidade ---

Deno.test("ONDA 1 BUGFIX — Tabela Diferenciada via rule.calculations[] não duplica quantidade", () => {
  const tableId = "table-bugfix";
  const code = "30715091";
  const lookup = (tid: string, c: string, _role?: string | null, roleSpecific?: boolean) => {
    if (tid !== tableId || c !== code) return null;
    if (roleSpecific === true) return null;
    return 1525.45;
  };

  // Caminho MODERNO: TD declarada DENTRO de rule.calculations[], não nos campos legados.
  const rule = makeRule({
    id: "rule-bugfix-td-modern",
    name: "TD via calculations[] — bugfix",
    calculation_type: "tabela_diferenciada",
    reference_table_id: null as any,
    multiplier: null as any,
    repasse_pct: null as any,
    calculations: [
      {
        id: "calc-td-1",
        sort_order: 0,
        label: "TD Outra Via",
        calculation_type: "tabela_diferenciada",
        reference_table_id: tableId,
        multiplier: 1.5,
        apply_access_route: true,
      },
    ],
  });

  const item = makeItem({
    id: "item-bugfix",
    procedure_code: code,
    doctor_role: "Cirurgião Principal",
    access_route: "Via de acesso diferente", // 0.7 (outra via)
    quantity: 3,
    procedure_amount: 1525.45,
    gross_amount: 0,
  });

  const results = analyzePaymentItems([item], [rule], baseCtx, { referenceLookup: lookup });
  assertEquals(results.length, 1);

  // 1525.45 × 1.5 = 2288.18 → × 0.7 = 1601.73 → × 3 = 4805.18
  // (sem deflator, sem repasse, cirurgião principal)
  // Cálculo esperado correto, NÃO 14415.53 (que seria com qtd duplicada).
  // Recalculando com round2 por etapa: 1525.45 → 2288.18 → 1601.73 → 1601.73 → 4805.19
  assertEquals(results[0].expected_amount, 4805.19);

  const explanation = results[0].calculation_explanation ?? "";
  // Garante que "× qtd 3" aparece exatamente UMA vez (não duplicada)
  const matches = explanation.match(/× qtd 3/g) ?? [];
  assertEquals(matches.length, 1, `Explicação deveria ter exatamente 1 "× qtd 3", encontrou ${matches.length}: ${explanation}`);
});
