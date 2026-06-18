/**
 * Regressão: pacotes COM `package_roles_distribution` devem distribuir o
 * valor por função do médico — cirurgião recebe o seu valor, 1º aux o seu,
 * 2º aux o seu. Funções fora da distribuição caem para outros cálculos.
 * Múltiplos itens da MESMA função no mesmo atendimento: o primeiro leva
 * o valor, os demais ficam absorvidos (expected=0) — sem duplicação.
 *
 * Caso real (Hospital DF Star, atendimento 8952448, regra Cirurgia Torácica):
 *   Pacote Lobectomia 29.321,93:
 *     cirurgiao → 19.547,95
 *     aux1      →  5.864,39
 *     aux2      →  3.909,59
 *   Antes do fix, calcPacotePorAtendimento devolvia o pacote cheio para
 *   o primeiro item e 0 para os demais — ignorando a distribuição.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyCalculation, type ItemInput, type RuleInput } from "./rulesEngine.ts";

function makeRule(): RuleInput {
  return {
    id: "rule-torax-dist",
    name: "Cirurgia Torácica — Pacote com Distribuição",
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
        id: "calc-pkg-lobectomia-dist",
        sort_order: 0,
        label: "Pacote Lobectomia",
        calculation_type: "pacote",
        package_main_code: "30803217",
        package_included_codes: [],
        package_amount: 29321.93,
        // distribuição por função — total das partes = package_amount
        package_roles_distribution: [
          { role_key: "cirurgiao", dist_type: "fixo", value: 19547.95, label: "Cirurgião Principal" },
          { role_key: "aux1", dist_type: "fixo", value: 5864.39, label: "1º Auxiliar" },
          { role_key: "aux2", dist_type: "fixo", value: 3909.59, label: "2º Auxiliar" },
        ],
      } as any,
    ],
  } as unknown as RuleInput;
}

function makeItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "it-default",
    doctor_name: "Médico",
    doctor_document: "1",
    company_name: "ACME",
    company_id: "c-1",
    company_document: "00000000000000",
    procedure_code: "30803217",
    procedure_name: "Lobectomia Pulmonar Por Videotoracoscopia",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 19547.95,
    gross_amount: 19547.95,
    attendance_number: "8952448",
    patient_name: "Maria",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: "Unafisco",
    specialty: null,
    ...overrides,
  } as ItemInput;
}

Deno.test("Distribuição por função: cirurgião recebe sua fatia", () => {
  const out = applyCalculation(makeRule(), makeItem({
    id: "cir", doctor_role: "Cirurgião Principal",
  }));
  assertEquals(out.expected, 19547.95);
});

Deno.test("Distribuição por função: 1º Aux recebe sua fatia (alias 'Primeiro Aux' → aux1)", () => {
  const out = applyCalculation(makeRule(), makeItem({
    id: "aux1", doctor_name: "Felipe", doctor_role: "Primeiro Aux",
  }));
  assertEquals(out.expected, 5864.39);
});

Deno.test("Distribuição por função: 2º Aux recebe sua fatia (alias 'Segundo Aux' → aux2)", () => {
  const out = applyCalculation(makeRule(), makeItem({
    id: "aux2", doctor_name: "João", doctor_role: "Segundo Aux",
  }));
  assertEquals(out.expected, 3909.59);
});

Deno.test("Distribuição em %: aux1 ganha (pct/100)*package_amount", () => {
  const rule = makeRule();
  (rule as any).calculations[0].package_roles_distribution = [
    { role_key: "cirurgiao", dist_type: "pct", value: 66.6667, label: "Cirurgião" },
    { role_key: "aux1", dist_type: "pct", value: 20, label: "1º Aux" },
  ];
  const out = applyCalculation(rule, makeItem({
    id: "aux1-pct", doctor_role: "1º Auxiliar",
  }));
  assertEquals(out.expected, Number(((20 / 100) * 29321.93).toFixed(2)));
});

Deno.test("Função FORA da distribuição: retorna null → não trava cálculo (cai em fallback)", () => {
  const out = applyCalculation(makeRule(), makeItem({
    id: "instru", doctor_name: "Inst", doctor_role: "Instrumentador",
  }));
  // Sem entrada no distribution → expected null com alerta, permitindo
  // que o motor exterior selecione outro cálculo/regra.
  assertEquals(out.expected, null);
});

Deno.test("Mesma função 2x no mesmo atendimento: 1º leva valor, 2º é absorvido", () => {
  const rule = makeRule();
  const cItem = (rule as any).calculations[0];
  // Simula o fluxo: o motor reutiliza o mesmo Set 'applied' para o mesmo (rule,calc)
  // através do EngineCtx.appliedAttendancesByRule. Aqui chamamos applyCalculation
  // duas vezes para o MESMO atendimento + mesma função, partilhando ctx.
  const ctx = { appliedAttendancesByRule: new Map<string, Set<string>>() } as any;
  const first = applyCalculation(rule, makeItem({
    id: "cir-1", doctor_role: "Cirurgião Principal",
  }), ctx);
  const second = applyCalculation(rule, makeItem({
    id: "cir-2", doctor_role: "Cirurgião Principal",
  }), ctx);
  assertEquals(first.expected, 19547.95);
  assertEquals(second.expected, 0, "segundo item da mesma função deve ser absorvido");
  // sanity: garante que o calc usado é o pacote
  void cItem;
});

Deno.test("Atendimentos DIFERENTES: cada um recebe a fatia da função (não vaza dedup)", () => {
  const rule = makeRule();
  const ctx = { appliedAttendancesByRule: new Map<string, Set<string>>() } as any;
  const a = applyCalculation(rule, makeItem({
    id: "a-cir", attendance_number: "111", doctor_role: "Cirurgião Principal",
  }), ctx);
  const b = applyCalculation(rule, makeItem({
    id: "b-cir", attendance_number: "222", doctor_role: "Cirurgião Principal",
  }), ctx);
  assertEquals(a.expected, 19547.95);
  assertEquals(b.expected, 19547.95);
});

Deno.test("Pacote SEM distribuição: mantém comportamento legado (valor cheio em 1 item)", () => {
  const rule = makeRule();
  (rule as any).calculations[0].package_roles_distribution = null;
  (rule as any).calculations[0].package_main_code = "30803217";
  const ctx = { appliedAttendancesByRule: new Map<string, Set<string>>() } as any;
  const first = applyCalculation(rule, makeItem({
    id: "leg-1", doctor_role: "Cirurgião Principal",
  }), ctx);
  const second = applyCalculation(rule, makeItem({
    id: "leg-2", doctor_role: "Primeiro Aux",
  }), ctx);
  assertEquals(first.expected, 29321.93);
  assertEquals(second.expected, 0);
});
