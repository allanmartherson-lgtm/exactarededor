/**
 * Sub-Onda 2C — Detecção e resolução de duplicidade entre cálculos da mesma regra.
 *
 * 6 testes Deno puros sobre o motor:
 *   1. Detecção: 2+ cálculos válidos → calc_duplicity, expected=null.
 *   2. Detecção: 1 cálculo válido segue normal (não regrediu).
 *   3. Resolução: simula resolução do analista (valida payload da função SQL).
 *   4. Reanálise respeita resolution: motor pula detecção e usa cálculo escolhido.
 *   5. resolution_stale: cálculo escolhido foi removido da regra.
 *   6. Validações da função SQL (regras de guarda).
 */
import {
  assertEquals,
  assert,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyCalculation,
  type ItemInput,
  type RuleInput,
} from "./rulesEngine.ts";

function makeRuleWithTwoCalcs(): RuleInput {
  return {
    id: "rule-2c",
    name: "Regra 2C — dois cálculos válidos",
    rule_text: "",
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
    calculation_type: "percentual_sobre_convenio",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        id: "calc-A",
        sort_order: 0,
        label: "Cálculo A — 50% convênio",
        calculation_type: "percentual_sobre_convenio",
        convenio_percentage: 50,
      },
      {
        id: "calc-B",
        sort_order: 1,
        label: "Cálculo B — valor fixo R$ 200",
        calculation_type: "valor_fixo",
        fixed_amount: 200,
      },
    ],
  } as RuleInput;
}

function makeItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "it-2c",
    doctor_name: "Dra. Fulana",
    doctor_document: "111",
    company_name: "ACME",
    company_id: "company-1",
    company_document: "12345678000199",
    procedure_code: "30000000",
    procedure_name: "Proc",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 400,
    gross_amount: 400,
    attendance_number: "1",
    patient_name: "X",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: null,
    specialty: null,
    ...overrides,
  } as ItemInput;
}

// --- Teste 1: Detecção — 2+ cálculos válidos → calc_duplicity ---
Deno.test("2C/1 — 2+ cálculos válidos para o mesmo item geram calc_duplicity (expected=null)", () => {
  const rule = makeRuleWithTwoCalcs();
  const item = makeItem();
  const out = applyCalculation(rule, item);
  assertEquals(out.expected, null, "expected deve ser null em duplicidade");
  assertExists(out.calc_duplicity, "calc_duplicity deve estar preenchido");
  assertEquals(out.calc_duplicity!.matched_calculations.length, 2);
  assertEquals(out.calc_duplicity!.rule_id, "rule-2c");
  assertEquals(out.calc_duplicity!.matched_calculations[0].calc_id, "calc-A");
  assertEquals(out.calc_duplicity!.matched_calculations[1].calc_id, "calc-B");
  assertEquals(out.calc_duplicity!.matched_calculations[0].expected, 200); // 50% de 400
  assertEquals(out.calc_duplicity!.matched_calculations[1].expected, 200);
});

// --- Teste 2: Detecção — 1 cálculo válido segue normal ---
Deno.test("2C/2 — 1 único cálculo válido segue normal, sem calc_duplicity", () => {
  const rule = makeRuleWithTwoCalcs();
  // Remove o segundo cálculo
  (rule as any).calculations = [(rule as any).calculations[0]];
  const item = makeItem();
  const out = applyCalculation(rule, item);
  assertEquals(out.expected, 200);
  assertEquals(out.calc_duplicity, undefined);
});

// --- Teste 3: Resolução — payload válido (mirror das guardas SQL) ---
function validateResolutionPayload(input: {
  justification: string;
  chosen_calc_id: string | null;
  matched_calculations: Array<{ calc_id: string | null }>;
  has_role: boolean;
}): { ok: boolean; code?: string } {
  if (!input.has_role) return { ok: false, code: "42501" };
  if (!input.justification || input.justification.trim().length < 20) return { ok: false, code: "22023" };
  if (!input.chosen_calc_id) return { ok: false, code: "22023" };
  const found = input.matched_calculations.some((c) => c.calc_id === input.chosen_calc_id);
  if (!found) return { ok: false, code: "22023" };
  return { ok: true };
}

Deno.test("2C/3 — Resolução com payload válido passa nas guardas (espelha apply_calc_duplicity_resolution)", () => {
  const rule = makeRuleWithTwoCalcs();
  const item = makeItem();
  const out = applyCalculation(rule, item);
  const matched = out.calc_duplicity!.matched_calculations;

  const res = validateResolutionPayload({
    has_role: true,
    justification: "Justificativa válida com mais de vinte caracteres explicando a escolha do cálculo A.",
    chosen_calc_id: "calc-A",
    matched_calculations: matched,
  });
  assertEquals(res.ok, true);
});

// --- Teste 4: Reanálise respeita resolution e usa valor recalculado da regra atual ---
Deno.test("2C/4 — Reanálise com calc_duplicity_resolution pula bloqueio e aplica cálculo escolhido (valor recalculado)", () => {
  const rule = makeRuleWithTwoCalcs();
  // Item agora com procedure_amount diferente para garantir que o valor é RECALCULADO,
  // não preservado da resolução antiga.
  const item = makeItem({
    procedure_amount: 1000,
    gross_amount: 1000,
    calc_duplicity_resolution: { chosen_calc_id: "calc-A" },
  });
  const out = applyCalculation(rule, item);
  assertEquals(out.calc_duplicity, undefined, "Sem calc_duplicity quando resolução é válida");
  assertEquals(out.expected, 500, "Valor recalculado: 50% de 1000 = 500 (não os 200 antigos)");
  assert(out.explanation.includes("Cálculo A"), "Explicação refere o cálculo escolhido");
});

// --- Teste 5: resolution_stale quando cálculo escolhido foi removido ---
Deno.test("2C/5 — Cálculo escolhido removido → resolution_stale + volta a bloquear se 2+ válidos", () => {
  const rule = makeRuleWithTwoCalcs();
  // Remove calc-A da regra (cenário: regra editada)
  (rule as any).calculations = [
    (rule as any).calculations[1],
    {
      id: "calc-C",
      sort_order: 2,
      label: "Cálculo C — 25% convênio",
      calculation_type: "percentual_sobre_convenio",
      convenio_percentage: 25,
    },
  ];
  const item = makeItem({
    calc_duplicity_resolution: { chosen_calc_id: "calc-A" }, // já não existe
  });
  const out = applyCalculation(rule, item);
  assertEquals(out.expected, null);
  assertExists(out.calc_duplicity);
  assertEquals(out.calc_duplicity!.resolution_stale, true);
  assertEquals(out.calc_duplicity!.matched_calculations.length, 2);

  // Cenário 5b: removendo calc-A E calc-C, sobra só calc-B → aplica B com stale flag.
  (rule as any).calculations = [(rule as any).calculations[0]]; // só calc-B
  const out2 = applyCalculation(rule, item);
  assertEquals(out2.expected, 200, "Aplica calc-B único");
  assertExists(out2.calc_duplicity, "calc_duplicity preserva flag stale");
  assertEquals(out2.calc_duplicity!.resolution_stale, true);
});

// --- Teste 6: Validações da função SQL (justificativa, chosen_calc_id, role) ---
Deno.test("2C/6 — Guardas SQL: justificativa<20, chosen_calc_id inválido, role ausente", () => {
  const matched = [{ calc_id: "calc-A" }, { calc_id: "calc-B" }];

  // 6a — justificativa < 20 chars → 22023
  assertEquals(
    validateResolutionPayload({
      has_role: true, justification: "curta", chosen_calc_id: "calc-A", matched_calculations: matched,
    }).code,
    "22023",
  );

  // 6b — chosen_calc_id fora de matched_calculations → 22023
  assertEquals(
    validateResolutionPayload({
      has_role: true,
      justification: "Justificativa válida com mais de vinte caracteres aqui escrita.",
      chosen_calc_id: "calc-XYZ-inexistente",
      matched_calculations: matched,
    }).code,
    "22023",
  );

  // 6c — usuário sem role permitida → 42501
  assertEquals(
    validateResolutionPayload({
      has_role: false,
      justification: "Justificativa válida com mais de vinte caracteres aqui escrita.",
      chosen_calc_id: "calc-A",
      matched_calculations: matched,
    }).code,
    "42501",
  );
});
