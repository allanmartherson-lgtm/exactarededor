/**
 * Regressão: quando uma regra tem um cálculo de pacote (ou valor_fixo)
 * que lista o código do item explicitamente E um cálculo catch-all
 * (tabela CBHPM x N + %), o cálculo explícito DEVE vencer — mesmo que
 * o catch-all tenha doctor_roles preenchido.
 *
 * Caso real (Hospital DF Star, regra Cirurgia Torácica):
 *   - Pacote Lobectomia: package_main_code=30803217, package_amount=29321.93
 *   - CBHPM 2018 x 2 + 20%: tabela_diferenciada, doctor_roles=[cirurgiao,...]
 *   Antes do fix o motor escolhia o CBHPM (restritivo por axis 4) e
 *   ignorava o pacote (catch-all). Após o fix, o pacote vence por
 *   listar 30803217 explicitamente.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyCalculation, type ItemInput, type RuleInput } from "./rulesEngine.ts";

function makeRule(): RuleInput {
  return {
    id: "rule-torax",
    name: "Cirurgia Torácica",
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
        id: "calc-pkg-lobectomia",
        sort_order: 0,
        label: "Pacote Lobectomia",
        calculation_type: "pacote",
        package_main_code: "30803217",
        package_included_codes: ["30805228", "30804132", "40201058", "30804183"],
        package_amount: 29321.93,
      },
      {
        id: "calc-cbhpm",
        sort_order: 21,
        label: "CBHPM 2018 x 2 + 20%",
        calculation_type: "tabela_diferenciada",
        multiplier: 2,
        acrescimo_pct: 20,
        doctor_roles: ["cirurgiao_principal", "primeiro_auxiliar", "segundo_auxiliar"],
        reference_table_id: "ref-cbhpm-2018",
      },
    ],
  } as unknown as RuleInput;
}

function makeItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: "it-explicit",
    doctor_name: "Evandro Luiz Brum",
    doctor_document: "999",
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

Deno.test("Pacote que lista o código explicitamente vence catch-all CBHPM (sem ambiguidade)", () => {
  const out = applyCalculation(makeRule(), makeItem());
  // Sem ambiguidade — explicit precedence deveria filtrar o CBHPM antes
  // do bloqueio por 2+ restritivos.
  assertEquals(out.calc_duplicity, undefined, "não pode bloquear por duplicidade");
  // Pacote vencedor → expected = package_amount (na função do pacote o
  // valor depende do role, mas para o cirurgião principal sai o pacote
  // cheio; aqui validamos apenas que NÃO veio do CBHPM).
  const expl = (out.explanation || "").toLowerCase();
  if (!expl.includes("pacote") && !expl.includes("lobectomia")) {
    throw new Error(`Esperava pacote vencedor, veio: ${out.explanation}`);
  }
});

Deno.test("Item de código FORA do pacote ainda cai no CBHPM catch-all", () => {
  // Código que não está em nenhum pacote desta regra → o explicit
  // precedence não filtra nada → CBHPM (único restritivo) vence.
  const out = applyCalculation(
    makeRule(),
    makeItem({ procedure_code: "99999999", procedure_name: "Outro" }),
  );
  assertEquals(out.calc_duplicity, undefined);
  const expl = (out.explanation || "").toLowerCase();
  if (!expl.includes("cbhpm")) {
    throw new Error(`Esperava CBHPM, veio: ${out.explanation}`);
  }
});
