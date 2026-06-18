/**
 * TESTE DE INTEGRAÇÃO — fluxo fim-a-fim do motor de pacote com distribuição.
 *
 * Por que existe (vs. packageRolesDistribution_test.ts):
 *   Os testes unitários chamam `applyCalculation` para 1 item de cada vez.
 *   Eles validam a função, mas NÃO o caminho real que a base importada faz:
 *
 *     analyzePaymentItems()
 *       └─ preFilterRules         (filtros de escopo/setor)
 *       └─ preComputePackageWinners (lock de pacote por (atendimento,regra))
 *       └─ analyzeItem ×N
 *            └─ applyCalculation
 *                 └─ ruleFromCalcItem        (propaga distribution)
 *                 └─ calcPacotePorAtendimento (distribui por função)
 *       └─ selectMainProcedures
 *
 *   É aqui que regressões aparecem em produção: o engine isolado funciona,
 *   mas a interação entre lock de pacote, dedup por atendimento e
 *   propagação da `package_roles_distribution` entre múltiplos itens quebra.
 *
 * Cenários cobertos (todos numa única chamada de analyzePaymentItems para
 * simular o que a edge function `analyze-payment` faz em produção):
 *
 *   Atendimento A (8952448) — 3 médicos no código do pacote
 *     - cir, aux1, aux2  → cada um recebe sua fatia da distribuição
 *   Atendimento A — 2ª via do mesmo cirurgião
 *     - cir #2           → expected = 0 (absorvido, não duplica pacote)
 *   Atendimento A — função fora da distribuição
 *     - instrumentador   → cai no fallback CBHPM, não trava o pacote
 *   Atendimento A — código DIFERENTE do pacote
 *     - código avulso    → CBHPM (catch-all), pacote não vaza
 *   Atendimento B (9999999) — outro paciente, mesma regra
 *     - cir              → recebe sua fatia integral (dedup não vaza
 *                          entre atendimentos)
 *
 * Caso real: Hospital DF Star, regra Cirurgia Torácica.
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type ReferenceTableLookup,
  type RuleInput,
} from "./rulesEngine.ts";

const CBHPM_REF_ID = "ref-cbhpm-2018";

/** Lookup CBHPM determinístico — código âncora + um código avulso. */
const referenceLookup: ReferenceTableLookup = (refId, code) => {
  if (refId !== CBHPM_REF_ID) return null;
  // valores base (porte cirurgião principal)
  const table: Record<string, number> = {
    "30803217": 1000.00, // âncora do pacote — só usado se pacote NÃO ganhar
    "30805228": 500.00,  // código avulso
  };
  return table[code] ?? null;
};

function makeRule(): RuleInput {
  return {
    id: "rule-torax-int",
    name: "Cirurgia Torácica (integração)",
    rule_text: "",
    description: null,
    active: true,
    severity: "aviso",
    scope: "master",
    sector: "outro",
    sectors: ["outro"],
    specialties: null,
    target_type: "hospital",
    target_identifier: null,
    target_name: null,
    target_company_id: null,
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "pacote",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        id: "calc-pkg",
        sort_order: 0,
        label: "Pacote Lobectomia",
        calculation_type: "pacote",
        package_main_code: "30803217",
        package_included_codes: [],
        package_amount: 29321.93,
        package_roles_distribution: [
          { role_key: "cirurgiao", dist_type: "fixo", value: 19547.95, label: "Cirurgião" },
          { role_key: "aux1", dist_type: "fixo", value: 5864.39, label: "1º Aux" },
          { role_key: "aux2", dist_type: "fixo", value: 3909.59, label: "2º Aux" },
        ],
      } as any,
      {
        id: "calc-cbhpm",
        sort_order: 21,
        label: "CBHPM 2018 x 2 + 20%",
        calculation_type: "tabela_diferenciada",
        multiplier: 2,
        acrescimo_pct: 20,
        doctor_roles: ["cirurgiao_principal", "primeiro_auxiliar", "segundo_auxiliar", "instrumentador"],
        reference_table_id: CBHPM_REF_ID,
      } as any,
    ],
  } as unknown as RuleInput;
}

function makeItem(over: Partial<ItemInput> & { id: string }): ItemInput {
  return {
    id: over.id,
    doctor_name: "Médico",
    doctor_document: "1",
    company_name: "ACME",
    company_id: "c-1",
    company_document: "00000000000000",
    procedure_code: "30803217",
    procedure_name: "Lobectomia",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 1000,
    gross_amount: 1000,
    attendance_number: "8952448",
    patient_name: "Maria",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: "Unafisco",
    specialty: null,
    ...over,
  } as ItemInput;
}

const ctx: PaymentContext = {
  sectors: ["outro"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-05-01",
};

function byId(results: Array<{ item_id: string; expected_amount: number | null }>) {
  return new Map(results.map((r) => [r.item_id, r.expected_amount]));
}

Deno.test("Integração fim-a-fim: pacote com distribuição em múltiplos atendimentos", () => {
  const rule = makeRule();
  const items: ItemInput[] = [
    // ─── Atendimento A — código do pacote, 3 funções ───
    makeItem({ id: "A-cir",  doctor_name: "Cirurgião A",  doctor_document: "11", doctor_role: "Cirurgião Principal" }),
    makeItem({ id: "A-aux1", doctor_name: "1º Aux A",     doctor_document: "12", doctor_role: "Primeiro Aux" }),
    makeItem({ id: "A-aux2", doctor_name: "2º Aux A",     doctor_document: "13", doctor_role: "Segundo Aux" }),
    // ─── Atendimento A — 2ª via do MESMO cirurgião (mesmo código âncora) ───
    makeItem({ id: "A-cir-2", doctor_name: "Cirurgião A", doctor_document: "11", doctor_role: "Cirurgião Principal", access_route: "outra-via" }),
    // ─── Atendimento A — função FORA da distribuição (no código âncora) ───
    makeItem({ id: "A-instru", doctor_name: "Instrum A",  doctor_document: "14", doctor_role: "Instrumentador" }),
    // ─── Atendimento A — código AVULSO (fora do pacote) → cai em CBHPM ───
    makeItem({
      id: "A-avulso", procedure_code: "30805228", procedure_name: "Avulso",
      doctor_name: "Cirurgião A", doctor_document: "11", doctor_role: "Cirurgião Principal",
    }),
    // ─── Atendimento B — outro paciente, mesma regra ───
    makeItem({
      id: "B-cir", attendance_number: "9999999", patient_name: "João",
      doctor_name: "Cirurgião B", doctor_document: "21", doctor_role: "Cirurgião Principal",
    }),
  ];

  const out = analyzePaymentItems(items, [rule], ctx, { referenceLookup });
  const got = byId(out);

  // ── Atendimento A: distribuição correta por função ──
  assertEquals(got.get("A-cir"),  19547.95, "cirurgião A → sua fatia");
  assertEquals(got.get("A-aux1"), 5864.39,  "1º Aux A → sua fatia");
  assertEquals(got.get("A-aux2"), 3909.59,  "2º Aux A → sua fatia");

  // ── Atendimento A: segunda via do cirurgião absorvida ──
  assertEquals(got.get("A-cir-2"), 0, "2ª via do cirurgião no MESMO atendimento absorvida (não duplica pacote)");

  // ── Atendimento A: instrumentador (fora da distribuição) cai em CBHPM ──
  // CBHPM = 1000 * 2 * 1.20 = 2400; factor de role pode reduzir, mas valor > 0.
  const instru = out.find((r) => r.item_id === "A-instru")!;
  assert(
    instru.expected_amount !== null && instru.expected_amount > 0,
    `instrumentador deveria cair no CBHPM (>0), veio ${instru.expected_amount}`,
  );
  assert(
    instru.calculation_explanation.toLowerCase().includes("cbhpm") ||
      instru.calculation_explanation.toLowerCase().includes("tabela"),
    `instrumentador deveria explicar CBHPM, veio: ${instru.calculation_explanation}`,
  );

  // ── Atendimento A: código avulso (fora do pacote) cai em CBHPM ──
  const avulso = out.find((r) => r.item_id === "A-avulso")!;
  assert(
    avulso.expected_amount !== null && avulso.expected_amount > 0,
    `código avulso deveria cair em CBHPM (>0), veio ${avulso.expected_amount}`,
  );

  // ── Atendimento B: dedup NÃO vaza entre atendimentos ──
  assertEquals(got.get("B-cir"), 19547.95, "cirurgião B (outro atendimento) → fatia integral");
});

Deno.test("Integração fim-a-fim: distribuição em percentual sobre múltiplos atendimentos", () => {
  const rule = makeRule();
  (rule as any).calculations[0].package_roles_distribution = [
    { role_key: "cirurgiao", dist_type: "pct", value: 70, label: "Cirurgião" },
    { role_key: "aux1", dist_type: "pct", value: 20, label: "1º Aux" },
    { role_key: "aux2", dist_type: "pct", value: 10, label: "2º Aux" },
  ];
  const expectedCir = Number(((70 / 100) * 29321.93).toFixed(2));
  const expectedAux1 = Number(((20 / 100) * 29321.93).toFixed(2));
  const expectedAux2 = Number(((10 / 100) * 29321.93).toFixed(2));

  const items: ItemInput[] = [
    makeItem({ id: "A-cir",  doctor_role: "Cirurgião Principal", doctor_document: "11", doctor_name: "Cir A" }),
    makeItem({ id: "A-aux1", doctor_role: "Primeiro Aux",        doctor_document: "12", doctor_name: "Aux1 A" }),
    makeItem({ id: "A-aux2", doctor_role: "Segundo Aux",         doctor_document: "13", doctor_name: "Aux2 A" }),
    makeItem({ id: "B-cir",  attendance_number: "777", doctor_role: "Cirurgião Principal", doctor_document: "21", doctor_name: "Cir B" }),
  ];

  const out = analyzePaymentItems(items, [rule], ctx, { referenceLookup });
  const got = byId(out);

  assertEquals(got.get("A-cir"),  expectedCir);
  assertEquals(got.get("A-aux1"), expectedAux1);
  assertEquals(got.get("A-aux2"), expectedAux2);
  assertEquals(got.get("B-cir"),  expectedCir, "atendimento B isolado");
});

Deno.test("Integração fim-a-fim: pacote SEM distribuição (legado) ainda funciona", () => {
  const rule = makeRule();
  (rule as any).calculations[0].package_roles_distribution = null;

  const items: ItemInput[] = [
    makeItem({ id: "A-cir",  doctor_role: "Cirurgião Principal", doctor_document: "11", doctor_name: "Cir" }),
    makeItem({ id: "A-aux1", doctor_role: "Primeiro Aux",        doctor_document: "12", doctor_name: "Aux1" }),
  ];

  const out = analyzePaymentItems(items, [rule], ctx, { referenceLookup });
  const got = byId(out);

  // Legado: o primeiro item (cirurgião pela ordenação) leva o pacote cheio,
  // os demais ficam absorvidos.
  assertEquals(got.get("A-cir"),  29321.93, "legado: 1º item leva pacote cheio");
  assertEquals(got.get("A-aux1"), 0,        "legado: demais absorvidos");
});
