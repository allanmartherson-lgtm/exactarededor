import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildCrossPjCodeSet,
  pickAllPackagesForAttendance,
  pickPackageForAttendance,
  type PkgCalc,
} from "./packagePicker.ts";


/**
 * Helpers
 */
function makeCalc(over: Partial<PkgCalc> & { main: string; included?: string[]; id?: string }): PkgCalc {
  return {
    rule_id: over.rule_id ?? `rule-${over.id ?? over.main}`,
    rule_name: over.rule_name ?? `Rule ${over.main}`,
    calc_id: over.calc_id ?? `calc-${over.id ?? over.main}`,
    package_main_codes: [over.main],
    package_included_codes: over.included ?? [],
    package_amount: over.package_amount ?? 10000,
    package_roles_distribution: over.package_roles_distribution ?? null,
    rule_company_ids: over.rule_company_ids ?? new Set<string>(),
    rule_scope: over.rule_scope ?? "master",
  };
}

Deno.test("cross-PJ: pacote casa quando main_code está em PJ diferente da atual", () => {
  // Cenário: Cirurgião na SALUTAIRE (main_code 30803217),
  // 1º Aux na THORAX (apenas código auxiliar 30803225).
  // O worker da THORAX vê localCodeSet = {30803225} e NÃO casaria sozinho.
  const calc = makeCalc({ main: "30803217", included: ["30803225", "30803233"] });

  const localCodeSet = new Set(["30803225"]); // só o que THORAX vê
  const localMatch = pickPackageForAttendance([calc], localCodeSet, new Set(["thorax-id"]));
  assertStrictEquals(localMatch, null, "sem expansão cross-PJ não deve casar");

  // Construindo codeSet cross-PJ via helper, simulando rows de TODAS as PJs do payment.
  const crossPj = buildCrossPjCodeSet([
    { attendance_number: "ATD-1", procedure_code: "30803217" }, // SALUTAIRE
    { attendance_number: "ATD-1", procedure_code: "30803225" }, // THORAX
    { attendance_number: "ATD-1", procedure_code: null },        // ignorado
    { attendance_number: "", procedure_code: "99999999" },        // ignorado
  ]);
  assert(crossPj["ATD-1"].has("30803217"));
  assert(crossPj["ATD-1"].has("30803225"));

  const crossMatch = pickPackageForAttendance([calc], crossPj["ATD-1"], new Set(["thorax-id"]));
  assert(crossMatch, "com codeSet expandido cross-PJ o pacote deve casar");
  assertEquals(crossMatch!.triggerCode, "30803217");
  assertEquals(crossMatch!.includedFound, ["30803225"]);
  assert(crossMatch!.absorbedCodes.has("30803217"));
  assert(crossMatch!.absorbedCodes.has("30803225"));
});

Deno.test("cross-PJ: empate em coverageCount vence o de included_codes mais específicos", () => {
  const calcA = makeCalc({ id: "A", main: "M1", included: ["X1"] });
  const calcB = makeCalc({ id: "B", main: "M1", included: ["X1", "X2", "X3"] });

  const codeSet = new Set(["M1", "X1"]); // ambos têm coverage=1
  const m = pickPackageForAttendance([calcA, calcB], codeSet, new Set(["comp"]));
  assert(m);
  assertEquals(m!.calc.rule_id, "rule-B", "mais included declarados (mais específico) ganha");
});

Deno.test("cross-PJ: maior cobertura vence sobre o menos coberto", () => {
  const calcSmall = makeCalc({ id: "S", main: "M1", included: ["X1"] });
  const calcBig = makeCalc({ id: "B", main: "M1", included: ["X1", "X2"] });

  const codeSet = new Set(["M1", "X1", "X2"]); // big tem cov=2, small cov=1
  const m = pickPackageForAttendance([calcSmall, calcBig], codeSet, new Set(["c"]));
  assert(m);
  assertEquals(m!.calc.rule_id, "rule-B");
  assertEquals(m!.coverageCount, 2);
});

Deno.test("cross-PJ: rule_scope='grupo' filtra por company_ids do atendimento", () => {
  const calc = makeCalc({
    main: "M1",
    included: ["X1"],
    rule_scope: "grupo",
    rule_company_ids: new Set(["SALUTAIRE"]),
  });

  const codeSet = new Set(["M1", "X1"]);

  // Atendimento só tem THORAX → regra não se aplica.
  const notApplied = pickPackageForAttendance([calc], codeSet, new Set(["THORAX"]));
  assertStrictEquals(notApplied, null);

  // Atendimento envolve SALUTAIRE também (cross-PJ) → regra se aplica.
  const applied = pickPackageForAttendance([calc], codeSet, new Set(["THORAX", "SALUTAIRE"]));
  assert(applied);
  assertEquals(applied!.triggerCode, "M1");
});

Deno.test("cross-PJ: sem main_code no codeSet, nada casa", () => {
  const calc = makeCalc({ main: "MAIN", included: ["A", "B"] });
  const m = pickPackageForAttendance([calc], new Set(["A", "B"]), new Set(["c"]));
  assertStrictEquals(m, null);
});

Deno.test("pacote com inclusos declarados não casa se só o main_code apareceu", () => {
  const combo = makeCalc({ id: "combo", main: "30804132", included: ["30804086"] });
  const excedente = makeCalc({ id: "excedente", main: "30804132", included: [] });

  const m = pickPackageForAttendance([combo, excedente], new Set(["30804132"]), new Set(["c"]));
  assert(m);
  assertEquals(m!.calc.rule_id, "rule-excedente");
  assertEquals(m!.includedFound, []);
});

// Regression — Cirurgia Torácica DF Star / TUSS 30804132:
// Existem dois cálculos com o MESMO package_main_code:
//   (a) "Pacote Drenagem Torácica" — combo com vários included_codes
//   (b) "Excedente – Drenagem Pleural / Toracostomia / Toracotomia Bilateral" — sem included
// Quando NENHUM dos included do combo aparece no atendimento, o motor DEVE escolher
// a linha de excedente, não o pacote combo (que antes vencia por "mais específico").
// Bug reproduzido em payment 9147596 / item c3aa9687-d766-48c5-9a8b-7b7c1fe0996d.
Deno.test("regressão: pacote combo sem inclusos cede para linha de excedente (TUSS 30804132)", () => {
  const combo = makeCalc({
    id: "combo-drenagem",
    main: "30804132",
    included: ["30804086", "30804094", "30804108"],
    rule_name: "Pacote Drenagem Torácica",
  });
  const excedente = makeCalc({
    id: "excedente-drenagem",
    main: "30804132",
    included: [],
    rule_name: "Excedente – Drenagem Pleural / Toracostomia / Toracotomia Bilateral",
  });

  // Atendimento só tem o main_code, nenhum included do combo.
  const codeSet = new Set(["30804132"]);

  // Testa as duas ordens para garantir determinismo da seleção.
  const m1 = pickPackageForAttendance([combo, excedente], codeSet, new Set(["c"]));
  assert(m1, "deve casar com a linha de excedente");
  assertEquals(m1!.calc.rule_id, "rule-excedente-drenagem");

  const m2 = pickPackageForAttendance([excedente, combo], codeSet, new Set(["c"]));
  assert(m2);
  assertEquals(m2!.calc.rule_id, "rule-excedente-drenagem", "ordem não pode mudar resultado");
});

// Sanity check oposto: quando os inclusos do combo APARECEM, o combo deve vencer.
Deno.test("regressão: pacote combo vence quando seus inclusos estão presentes", () => {
  const combo = makeCalc({
    id: "combo-drenagem",
    main: "30804132",
    included: ["30804086", "30804094"],
  });
  const excedente = makeCalc({
    id: "excedente-drenagem",
    main: "30804132",
    included: [],
  });

  const codeSet = new Set(["30804132", "30804086"]);
  const m = pickPackageForAttendance([combo, excedente], codeSet, new Set(["c"]));
  assert(m);
  assertEquals(m!.calc.rule_id, "rule-combo-drenagem");
  assertEquals(m!.includedFound, ["30804086"]);
});

Deno.test("buildCrossPjCodeSet agrupa por attendance e ignora linhas inválidas", () => {
  const out = buildCrossPjCodeSet([
    { attendance_number: " ATD-1 ", procedure_code: " 111 " },
    { attendance_number: "ATD-1", procedure_code: "222" },
    { attendance_number: "ATD-2", procedure_code: "333" },
    { attendance_number: null, procedure_code: "999" },
    { attendance_number: "ATD-3", procedure_code: null },
  ]);
  assertEquals([...out["ATD-1"]].sort(), ["111", "222"]);
  assertEquals([...out["ATD-2"]], ["333"]);
  assertEquals(out["ATD-3"], undefined);
  assertEquals(out[""], undefined);
});

// Regressão multi-pacote — atendimento 9147596 (Cirurgia Torácica DF Star):
// O atendimento tinha 3 grupos distintos:
//   • TUSS 30804132 (2 itens) → "Pacote Drenagem Torácica" (combo com included 30804086)
//   • TUSS 30804183 (2 itens) → absorvido pelo combo
//   • TUSS 31403379 (1 item)  → "Excedente – Simpatectomia por Videotoracoscopia" (sem included)
// Antes do fix, o motor escolhia UM pacote por atendimento e o 31403379 caía em fallback
// ("Regra Geral – Repasse 100% Convênio"). Agora deve aplicar AMBOS no mesmo atendimento.
Deno.test("multi-pacote: atendimento com pacote combo + excedente independente aplica os dois", () => {
  const combo = makeCalc({
    id: "combo-drenagem",
    main: "30804132",
    included: ["30804086"],
    rule_name: "Pacote Drenagem Torácica",
  });
  const excedenteSimpatectomia = makeCalc({
    id: "excedente-simpatectomia",
    main: "31403379",
    included: [],
    rule_name: "Excedente – Simpatectomia por Videotoracoscopia",
  });
  const excedenteDrenagem = makeCalc({
    id: "excedente-drenagem",
    main: "30804132",
    included: [],
    rule_name: "Excedente – Drenagem Pleural",
  });

  // codeSet do atendimento real: trigger do combo + included do combo + código avulso
  const codeSet = new Set(["30804132", "30804086", "31403379"]);
  const picks = pickAllPackagesForAttendance(
    [combo, excedenteSimpatectomia, excedenteDrenagem],
    codeSet,
    new Set(["c"]),
  );

  assertEquals(picks.length, 2, "deve aplicar dois pacotes no mesmo atendimento");
  // Primeira escolha: combo (maior cobertura). Segunda: excedente do código sobrando.
  assertEquals(picks[0].calc.rule_id, "rule-combo-drenagem");
  assert(picks[0].absorbedCodes.has("30804132"));
  assert(picks[0].absorbedCodes.has("30804086"));
  assertEquals(picks[1].calc.rule_id, "rule-excedente-simpatectomia");
  assertEquals(picks[1].triggerCode, "31403379");
});

Deno.test("multi-pacote: sem códigos remanescentes para após o primeiro pacote, para o loop", () => {
  const combo = makeCalc({ id: "combo", main: "M1", included: ["X1", "X2"] });
  const outro = makeCalc({ id: "outro", main: "M2" });

  // Só os códigos do combo aparecem; M2 não está no atendimento.
  const picks = pickAllPackagesForAttendance([combo, outro], new Set(["M1", "X1", "X2"]), new Set(["c"]));
  assertEquals(picks.length, 1);
  assertEquals(picks[0].calc.rule_id, "rule-combo");
});

Deno.test("multi-pacote: o mesmo calc nunca é aplicado duas vezes", () => {
  const exc = makeCalc({ id: "exc", main: "MAIN" });
  // Apenas um trigger no codeSet → não deve duplicar mesmo com 20 iterações disponíveis.
  const picks = pickAllPackagesForAttendance([exc], new Set(["MAIN"]), new Set(["c"]));
  assertEquals(picks.length, 1);
});
