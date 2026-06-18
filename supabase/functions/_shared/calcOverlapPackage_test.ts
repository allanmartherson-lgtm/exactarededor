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
 * NÃO conflitam, e pacotes com TUSS compartilhados conflitam mencionando o
 * código compartilhado.
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

// Builder de cálculo pacote com main + included + função (espelha excedentes reais).
function pkg(
  id: string,
  opts: {
    type?: typeof PACKAGE_KINDS[number];
    main?: string | null;
    included?: string[];
    roles?: string[];
    sort?: number;
  } = {},
): RuleCalculationItem {
  return {
    id,
    label: id,
    sort_order: opts.sort ?? 0,
    calculation_type: opts.type ?? "pacote",
    package_main_code: opts.main ?? null,
    package_included_codes: opts.included ?? [],
    doctor_roles: opts.roles ?? ["cirurgiao_principal"],
    code_match_mode: "any",
  } as unknown as RuleCalculationItem;
}

// --- Regressão principal: o caso real dos excedentes ---
Deno.test("pacote — 2 pacotes com TUSS totalmente disjuntos (mesmo papel) → SEM overlap", () => {
  // Lobectomia × Segmentectomia: TUSS distintos, mesma função "cirurgiao_principal".
  // Antes do fix isso gerava falso-positivo em "Função".
  const calcs = [
    pkg("lobectomia", {
      main: "30805228",
      included: ["30804132", "40201058", "30804183"],
      sort: 0,
    }),
    pkg("segmentectomia", {
      main: "30805236",
      included: ["30804140", "40201066"],
      sort: 1,
    }),
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

// Variante: cobre os quatro subtipos pacote*, garantindo que TODOS são tratados
// como whitelist implícita pelo eixo de códigos.
for (const t of PACKAGE_KINDS) {
  Deno.test(`pacote — subtipo "${t}" com TUSS disjuntos → SEM overlap`, () => {
    const calcs = [
      pkg("a", { type: t, main: "10000001", included: ["10000002"] }),
      pkg("b", { type: t, main: "20000001", included: ["20000002"], sort: 1 }),
    ];
    assertEquals(detectCalcOverlap(calcs), []);
  });
}

// --- Comportamento positivo: TUSS compartilhado realmente conflita ---
Deno.test("pacote — 2 pacotes compartilhando o package_main_code → calc_overlap citando o código", () => {
  const calcs = [
    pkg("p1", { main: "30805228", included: ["A"], sort: 0 }),
    pkg("p2", { main: "30805228", included: ["B"], sort: 1 }),
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("30805228")) {
    throw new Error(
      `Descrição deve citar TUSS compartilhado, recebi: ${out[0].intersection_description}`,
    );
  }
});

Deno.test("pacote — included_codes de um intercepta main_code do outro → conflita", () => {
  const calcs = [
    pkg("p1", { main: "30805228", included: ["40201058"], sort: 0 }),
    pkg("p2", { main: "40201058", included: ["99999999"], sort: 1 }),
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("40201058")) {
    throw new Error("Descrição deve citar TUSS compartilhado 40201058");
  }
});

// --- Mistura pacote × não-pacote ---
Deno.test("pacote × valor_fixo — TUSS do pacote disjuntos do whitelist do fixo → SEM overlap", () => {
  const calcs: RuleCalculationItem[] = [
    pkg("pacote-a", { main: "30805228", included: ["30804132"], sort: 0 }),
    {
      id: "fixo-b",
      label: "fixo",
      sort_order: 1,
      calculation_type: "valor_fixo",
      fixed_amount: 100,
      procedure_codes: ["99999999"],
      code_match_mode: "whitelist",
      doctor_roles: ["cirurgiao_principal"],
    } as unknown as RuleCalculationItem,
  ];
  assertEquals(detectCalcOverlap(calcs), []);
});

Deno.test("pacote × valor_fixo — TUSS do pacote contém código do fixo → conflita", () => {
  const calcs: RuleCalculationItem[] = [
    pkg("pacote-a", { main: "30805228", included: ["40201058"], sort: 0 }),
    {
      id: "fixo-b",
      label: "fixo",
      sort_order: 1,
      calculation_type: "valor_fixo",
      fixed_amount: 100,
      procedure_codes: ["40201058"],
      code_match_mode: "whitelist",
      doctor_roles: ["cirurgiao_principal"],
    } as unknown as RuleCalculationItem,
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("40201058")) {
    throw new Error("Descrição deve citar TUSS compartilhado 40201058");
  }
});

// --- package_main_code como string com múltiplos códigos (separadores , ; espaço) ---
Deno.test("pacote — package_main_code com múltiplos códigos separados → cada um conta como whitelist", () => {
  const calcs = [
    pkg("p1", { main: "30805228, 30805236; 30805244", sort: 0 }),
    pkg("p2", { main: "30805236", sort: 1 }),
  ];
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("30805236")) {
    throw new Error("Descrição deve citar 30805236");
  }
});

// --- Cross-rule (validate-rule-save) também deve respeitar package codes ---
Deno.test("cross-rule — pacotes de regras diferentes com TUSS disjuntos → SEM overlap cruzado", () => {
  const rule1 = [pkg("r1-a", { main: "30805228", included: ["30804132"] })];
  const rule2 = [pkg("r2-a", { main: "30805236", included: ["30804140"] })];
  assertEquals(detectCrossRuleOverlap(rule1, rule2), []);
});

Deno.test("cross-rule — pacotes de regras diferentes compartilhando TUSS → reporta overlap", () => {
  const rule1 = [pkg("r1-a", { main: "30805228", included: ["40201058"] })];
  const rule2 = [pkg("r2-a", { main: "40201058" })];
  const out = detectCrossRuleOverlap(rule1, rule2);
  assertEquals(out.length, 1);
  if (!out[0].intersection_description.includes("40201058")) {
    throw new Error("Cross-rule deve citar TUSS compartilhado 40201058");
  }
});

// --- Edge: pacote sem nenhum código declarado → vira "any" e cai em outros eixos ---
Deno.test("pacote — sem package_main_code nem included → eixo de códigos = any (conflita só se outro eixo bater)", () => {
  const calcs = [
    pkg("vazio-1", { main: null, included: [], roles: ["cirurgiao_principal"], sort: 0 }),
    pkg("vazio-2", { main: null, included: [], roles: ["cirurgiao_principal"], sort: 1 }),
  ];
  // Sem código + mesma função restrita → conflito (comportamento esperado).
  const out = detectCalcOverlap(calcs);
  assertEquals(out.length, 1);
});
