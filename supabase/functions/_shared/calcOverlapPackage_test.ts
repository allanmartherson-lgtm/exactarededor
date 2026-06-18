/**
 * Regressão — calcOverlap para cálculos do tipo `pacote*`.
 *
 * Bug original (2026-06-18): o detector lia apenas `procedure_codes` no eixo
 * de códigos. Para cálculos `pacote*` (pacote / pacote_por_atendimento /
 * pacote_fechado / pacote_com_extras) os TUSS vivem em `package_main_code`
 * e `package_included_codes`. O eixo virava "any" para ambos os lados, caía
 * só na função (doctor_roles, idêntica entre excedentes) e gerava 45
 * "Excedente × Excedente" falsos.
 *
 * Estes testes travam o comportamento corrigido: pacotes com TUSS disjuntos
 * NÃO conflitam; entre pacote e valor_fixo/tabela, o pacote tem precedência
 * contextual por atendimento e não deve bloquear o salvamento.
 *
 * Observação: `isRestrictiveCalculation` (em rulesEngine.ts) NÃO inspeciona
 * `package_main_code` — só os 9 eixos clássicos. Para forçar os cálculos a
 * entrarem no detector como "restritivos", os testes adicionam um eixo
 * diferenciador neutro (ex.: `extras_codes` distintos com elemento
 * compartilhado) que isola o comportamento do eixo de códigos sob teste.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectCalcOverlap, detectCrossRuleOverlap } from "./calcOverlap.ts";
import type { RuleCalculationItem } from "./rulesEngine.ts";

const PACKAGE_KINDS = [
  "pacote",
  "pacote_por_atendimento",
  "pacote_fechado",
  "pacote_com_extras",
] as const;

/**
 * Builder de cálculo pacote.
 * `restrictiveTag` injeta um extras_codes que torna o cálculo restritivo
 * com interseção não-vazia entre peers (driver neutro para
 * isRestrictiveCalculation, sem influenciar o eixo de códigos).
 */
function pkg(
  id: string,
  opts: {
    type?: typeof PACKAGE_KINDS[number];
    main?: string | null;
    included?: string[];
    roles?: string[];
    sort?: number;
    restrictiveTag?: string; // único por calc, faz isRestrictiveCalculation marcar
  } = {},
): RuleCalculationItem {
  const extras = opts.restrictiveTag
    ? [opts.restrictiveTag, "__shared_tag__"]
    : undefined;
  return {
    id,
    label: id,
    sort_order: opts.sort ?? 0,
    calculation_type: opts.type ?? "pacote",
    package_main_code: opts.main ?? null,
    package_included_codes: opts.included ?? [],
    doctor_roles: opts.roles ?? ["cirurgiao_principal"],
    code_match_mode: "any",
    extras_codes: extras,
  } as unknown as RuleCalculationItem;
}

// =====================================================================
// REGRESSÃO PRINCIPAL: o caso real dos 45 falsos "Excedente × Excedente"
// =====================================================================
Deno.test("pacote — 2 pacotes com TUSS totalmente disjuntos (mesmo papel) → SEM overlap", () => {
  // Lobectomia × Segmentectomia: TUSS distintos, mesma função.
  // Antes do fix, axisCodes ignorava package_* → eixo "any" dos dois lados →
  // detector caía só em doctor_roles (idênticos) → conflito falso.
  const calcs = [
    pkg("lobectomia", {
      main: "30805228",
      included: ["30804132", "40201058", "30804183"],
      restrictiveTag: "lobec",
      sort: 0,
    }),
    pkg("segmentectomia", {
      main: "30805236",
      included: ["30804140", "40201066"],
      restrictiveTag: "segm",
      sort: 1,
    }),
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// Cobertura: os QUATRO subtipos pacote* recebem o mesmo tratamento.
for (const t of PACKAGE_KINDS) {
  Deno.test(`pacote — subtipo "${t}" com TUSS disjuntos → SEM overlap`, () => {
    const calcs = [
      pkg("a", { type: t, main: "10000001", included: ["10000002"], restrictiveTag: "a" }),
      pkg("b", { type: t, main: "20000001", included: ["20000002"], restrictiveTag: "b", sort: 1 }),
    ];
    assertEquals(detectCalcOverlap(calcs), []);
  });
}

// =====================================================================
// COMPORTAMENTO POSITIVO: TUSS realmente compartilhado deve conflitar
// =====================================================================
Deno.test("pacote — 2 pacotes compartilhando package_main_code → calc_overlap citando o código", () => {
  const calcs = [
    pkg("p1", { main: "30805228", included: ["A"], restrictiveTag: "p1", sort: 0 }),
    pkg("p2", { main: "30805228", included: ["B"], restrictiveTag: "p2", sort: 1 }),
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("30805228")) {
    throw new Error(
      `Descrição deve citar TUSS compartilhado, recebi: ${out[0].intersection_description}`,
    );
  }
});

Deno.test("pacote — included_code de um intercepta main_code do outro → SEM overlap; pacote absorve por contexto", () => {
  const calcs = [
    pkg("p1", { main: "30805228", included: ["40201058"], restrictiveTag: "p1", sort: 0 }),
    pkg("p2", { main: "40201058", included: ["99999999"], restrictiveTag: "p2", sort: 1 }),
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// =====================================================================
// Mistura pacote × não-pacote
// =====================================================================
Deno.test("pacote × valor_fixo — TUSS do pacote disjuntos do whitelist do fixo → SEM overlap", () => {
  const calcs: RuleCalculationItem[] = [
    pkg("pacote-a", { main: "30805228", included: ["30804132"], restrictiveTag: "a", sort: 0 }),
    {
      id: "fixo-b",
      label: "fixo",
      sort_order: 1,
      calculation_type: "valor_fixo",
      fixed_amount: 100,
      procedure_codes: ["99999999"],
      code_match_mode: "whitelist",
      doctor_roles: ["cirurgiao_principal"],
      extras_codes: ["b", "__shared_tag__"],
    } as unknown as RuleCalculationItem,
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

Deno.test("pacote × valor_fixo — TUSS incluído no pacote também tem valor fixo → SEM overlap; pacote vence quando main presente", () => {
  const calcs: RuleCalculationItem[] = [
    pkg("pacote-a", { main: "30805228", included: ["40201058"], restrictiveTag: "a", sort: 0 }),
    {
      id: "fixo-b",
      label: "fixo",
      sort_order: 1,
      calculation_type: "valor_fixo",
      fixed_amount: 100,
      procedure_codes: ["40201058"],
      code_match_mode: "whitelist",
      doctor_roles: ["cirurgiao_principal"],
      extras_codes: ["b", "__shared_tag__"],
    } as unknown as RuleCalculationItem,
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// =====================================================================
// package_main_code como string com múltiplos códigos
// =====================================================================
Deno.test("pacote — package_main_code com múltiplos códigos separados → cada um conta como whitelist", () => {
  const calcs = [
    pkg("p1", { main: "30805228, 30805236; 30805244", restrictiveTag: "p1", sort: 0 }),
    pkg("p2", { main: "30805236", restrictiveTag: "p2", sort: 1 }),
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("30805236")) {
    throw new Error("Descrição deve citar 30805236");
  }
});

// =====================================================================
// Cross-rule (validate-rule-save) também respeita package codes
// =====================================================================
// Cross-rule precisa de >=2 cálculos por regra para isRestrictiveCalculation
// reconhecer ao menos um como restritivo (peers.length > 1 + eixo diferenciador).
Deno.test("cross-rule — pacotes de regras diferentes com TUSS disjuntos → SEM overlap cruzado", () => {
  const rule1 = [
    pkg("r1-a", { main: "30805228", included: ["30804132"], restrictiveTag: "r1a", sort: 0 }),
    pkg("r1-b", { main: "30805229", restrictiveTag: "r1b", sort: 1 }),
  ];
  const rule2 = [
    pkg("r2-a", { main: "30805236", included: ["30804140"], restrictiveTag: "r2a", sort: 0 }),
    pkg("r2-b", { main: "30805237", restrictiveTag: "r2b", sort: 1 }),
  ];
  assertEquals(detectCrossRuleOverlap(rule1, rule2), []);
});

Deno.test("cross-rule — pacotes de regras diferentes compartilhando TUSS → reporta overlap", () => {
  const rule1 = [
    pkg("r1-a", { main: "30805228", included: ["40201058"], restrictiveTag: "r1a", sort: 0 }),
    pkg("r1-b", { main: "99999998", restrictiveTag: "r1b", sort: 1 }),
  ];
  const rule2 = [
    pkg("r2-a", { main: "40201058", restrictiveTag: "r2a", sort: 0 }),
    pkg("r2-b", { main: "99999999", restrictiveTag: "r2b", sort: 1 }),
  ];
  const out = detectCrossRuleOverlap(rule1, rule2);
  // Deve haver ao menos um overlap citando 40201058.
  const hit = out.find((o) => o.intersection_description.includes("40201058"));
  if (!hit) {
    throw new Error(
      `Esperava overlap citando 40201058, recebi: ${JSON.stringify(out)}`,
    );
  }
});
