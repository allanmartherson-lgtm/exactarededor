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

Deno.test("regra sem filtro de setor não gera alerta exigindo cadastro de setor quando cálculo não casa", () => {
  const groupRule = makeRule({
    id: "rule-grupo-sem-setor",
    name: "Regra grupo sem setor",
    scope: "grupo",
    target_type: null,
    target_company_id: null,
    group_company_links: [{ company_id: "company-1", doctors: [] }],
    calculations: [
      {
        id: "calc-cirurgiao",
        label: "Somente cirurgião",
        calculation_type: "percentual_sobre_convenio",
        convenio_percentage: 200,
        procedure_codes: ["40813541"],
        code_match_mode: "whitelist",
        doctor_roles: ["cirurgiao"],
        sectors: [],
      },
    ],
  });

  const item = makeItem({
    procedure_code: "40813541",
    procedure_name: "Embolização cerebral",
    doctor_role: "Primeiro Auxiliar",
    sector: "hemodinamica",
    gross_amount: 100,
    procedure_amount: 100,
  });

  const [result] = analyzePaymentItems([item], [groupRule], { ...baseCtx, sectors: [] });

  assertEquals(result.matched_priority, "sem_regra");
  assertEquals(result.matched_rule_id, null);
  assertEquals(result.expected_amount, null);
  assertEquals(result.alerts.some((a) => /cadastre.*setor|setor:/.test(a.toLowerCase())), false);
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

// --- FIX Pacotes — escopo de códigos em calcItemMatches ---
import { calcItemMatches } from "./rulesEngine.ts";

Deno.test("calcItemMatches: item fora do escopo de um cálculo de pacote retorna ok:false", () => {
  const calc: any = {
    id: "c-pacote-q",
    sort_order: 0,
    label: "Quadrantectomia",
    calculation_type: "pacote",
    package_main_code: "30602190",
    package_included_codes: ["30602289", "30602254", "30602173"],
    procedure_codes: null,
    code_match_mode: "any",
    package_amount: 9718.72,
  };
  const item = makeItem({ procedure_code: "30602157" });
  const r = calcItemMatches(calc, item);
  assertEquals(r.ok, false);
  assertEquals((r as any).reason, "codigo_fora_do_pacote");
});

Deno.test("calcItemMatches: item que é o main_code do pacote passa", () => {
  const calc: any = {
    id: "c-pacote-q",
    calculation_type: "pacote",
    package_main_code: "30602190",
    package_included_codes: ["30602289"],
    code_match_mode: "any",
  };
  const item = makeItem({ procedure_code: "30602190" });
  assertEquals(calcItemMatches(calc, item).ok, true);
});

Deno.test("calcItemMatches: pacote sem package_main_code mantém comportamento legado (passa)", () => {
  const calc: any = {
    id: "c-pacote-legacy",
    calculation_type: "pacote",
    package_main_code: null,
    package_included_codes: null,
    code_match_mode: "any",
  };
  const item = makeItem({ procedure_code: "99999999" });
  assertEquals(calcItemMatches(calc, item).ok, true);
});

// --- FIX Pacotes — desempate por packageMatchScore entre pacotes elegíveis ---

Deno.test("Desempate por packageMatchScore: vence o pacote com maior sobreposição de inclusos", () => {
  // Pacote A (sort 0): main 30602149, inclusos [30602289] (1 incluído)
  // Pacote B (sort 1): main 30602149, inclusos [30602289, 30602262, 30602157] (3)
  // Atendimento: 30602149 + 30602289 + 30602157 → matches A=1/1=1.0; B=2/3=0.67
  // Vence A (score maior).
  const rule = makeRule({
    id: "rule-mastopack",
    name: "Mastologia Pacotes (test)",
    calculation_type: "pacote_por_atendimento",
    calculations: [
      {
        id: "calc-A",
        sort_order: 0,
        label: "Pacote A",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "30602149",
        package_included_codes: ["30602289"],
        package_amount: 1000,
        code_match_mode: "any",
      },
      {
        id: "calc-B",
        sort_order: 1,
        label: "Pacote B",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "30602149",
        package_included_codes: ["30602289", "30602262", "30602157"],
        package_amount: 9999,
        code_match_mode: "any",
      },
    ],
  } as any);

  const att = "9097530";
  const base = { attendance_number: att, procedure_amount: 100, gross_amount: 100 };
  const mainItem = makeItem({ id: "i-main", procedure_code: "30602149", ...base });
  const sib1 = makeItem({ id: "i-2", procedure_code: "30602289", ...base });
  const sib2 = makeItem({ id: "i-3", procedure_code: "30602157", ...base });

  const ctx: PaymentContext = { sectors: ["outro"], specialties: [], payment_type: null, reference_date: "2026-05-01" };
  const results = analyzePaymentItems([mainItem, sib1, sib2], [rule], ctx);
  const main = results.find((r) => r.item_id === "i-main")!;
  // Score: A=1.0 vence B=0.67 → applied = 1000 do Pacote A
  assertEquals(main.expected_amount, 1000);
});

Deno.test("Desempate por packageMatchScore: vence pacote mais específico quando todos inclusos batem", () => {
  // Pacote A (sort 0): main 30602157, inclusos [30602289] → 1/1 = 1.0
  // Pacote B (sort 1): main 30602157, inclusos [30602289, 30602149, 30602262] → 2/3 = 0.67
  // Atendimento: 30602157 + 30602289 + 30602149 → A vence
  const rule = makeRule({
    id: "rule-mastopack-2",
    name: "Mastologia Pacotes 2",
    calculation_type: "pacote_por_atendimento",
    calculations: [
      {
        id: "calc-A",
        sort_order: 0,
        label: "Pacote A small",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "30602157",
        package_included_codes: ["30602289"],
        package_amount: 5000,
        code_match_mode: "any",
      },
      {
        id: "calc-B",
        sort_order: 1,
        label: "Pacote B big",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "30602157",
        package_included_codes: ["30602289", "30602149", "30602262"],
        package_amount: 14315.59,
        code_match_mode: "any",
      },
    ],
  } as any);

  const att = "ATT-2";
  const base = { attendance_number: att, procedure_amount: 100, gross_amount: 100 };
  const items = [
    makeItem({ id: "m", procedure_code: "30602157", ...base }),
    makeItem({ id: "s1", procedure_code: "30602289", ...base }),
    makeItem({ id: "s2", procedure_code: "30602149", ...base }),
  ];
  const ctx: PaymentContext = { sectors: ["outro"], specialties: [], payment_type: null, reference_date: "2026-05-01" };
  const results = analyzePaymentItems(items, [rule], ctx);
  const main = results.find((r) => r.item_id === "m")!;
  assertEquals(main.expected_amount, 5000); // score 1.0 vence 0.67
});

// --- Correção C — Pré-passe por atendimento ---

Deno.test("Correção C: pré-passe escolhe pacote com maior cobertura do atendimento (não do item)", () => {
  // Pacote A: main M1, inclusos [X] → cobertura no atendimento {M1, M2, X, Y, Z} = 2 (M1, X)
  // Pacote B: main M2, inclusos [X, Y, Z] → cobertura = 4 (M2, X, Y, Z)
  // Esperado: B vence → expected = package_amount de B aplicado em item M2.
  const rule = makeRule({
    id: "rule-corr-c-1",
    name: "Corr C 1",
    calculation_type: "pacote_por_atendimento",
    calculations: [
      {
        id: "calc-A",
        sort_order: 0,
        label: "Pacote A (pequeno)",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "M1",
        package_included_codes: ["X"],
        package_amount: 1000,
        code_match_mode: "any",
      },
      {
        id: "calc-B",
        sort_order: 1,
        label: "Pacote B (grande)",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "M2",
        package_included_codes: ["X", "Y", "Z"],
        package_amount: 9000,
        code_match_mode: "any",
      },
    ],
  } as any);

  const att = "ATT-C1";
  const base = { attendance_number: att, procedure_amount: 100, gross_amount: 100 };
  const items = [
    makeItem({ id: "iM1", procedure_code: "M1", ...base }),
    makeItem({ id: "iM2", procedure_code: "M2", ...base }),
    makeItem({ id: "iX", procedure_code: "X", ...base }),
    makeItem({ id: "iY", procedure_code: "Y", ...base }),
    makeItem({ id: "iZ", procedure_code: "Z", ...base }),
  ];
  const ctx: PaymentContext = { sectors: ["outro"], specialties: [], payment_type: null, reference_date: "2026-05-01" };
  const results = analyzePaymentItems(items, [rule], ctx);

  const m2 = results.find((r) => r.item_id === "iM2")!;
  assertEquals(m2.expected_amount, 9000, "Pacote B (maior cobertura) deve aplicar em M2");

  // M1 não deve receber o package_amount do Pacote A (perdedor); deve ser
  // tratado como item embutido/sem-pacote → 0.
  const m1 = results.find((r) => r.item_id === "iM1")!;
  assertEquals(m1.expected_amount === 1000, false, "Pacote A não deve aplicar (perdeu pré-passe)");
});

Deno.test("Correção C: pacote cujo main_code não está nos siblings não é elegível", () => {
  const rule = makeRule({
    id: "rule-corr-c-2",
    name: "Corr C 2",
    calculation_type: "pacote_por_atendimento",
    calculations: [
      {
        id: "calc-Quad",
        sort_order: 0,
        label: "Quadrantectomia",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "Q-MAIN",
        package_included_codes: ["Q-A", "Q-B"],
        package_amount: 7000,
        code_match_mode: "any",
      },
      {
        id: "calc-Simp",
        sort_order: 1,
        label: "Simples",
        calculation_type: "pacote_por_atendimento",
        package_main_code: "S-MAIN",
        package_included_codes: ["Q-A"],
        package_amount: 12000,
        code_match_mode: "any",
      },
    ],
  } as any);

  const att = "ATT-C2";
  const base = { attendance_number: att, procedure_amount: 100, gross_amount: 100 };
  const items = [
    makeItem({ id: "iqm", procedure_code: "Q-MAIN", ...base }),
    makeItem({ id: "iqa", procedure_code: "Q-A", ...base }),
    makeItem({ id: "iqb", procedure_code: "Q-B", ...base }),
  ];
  const ctx: PaymentContext = { sectors: ["outro"], specialties: [], payment_type: null, reference_date: "2026-05-01" };
  const results = analyzePaymentItems(items, [rule], ctx);
  const main = results.find((r) => r.item_id === "iqm")!;
  assertEquals(main.expected_amount, 7000, "Quadrant deve vencer — Simples não é elegível (S-MAIN ausente)");
});
