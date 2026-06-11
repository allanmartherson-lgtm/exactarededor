import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildCrossPjCodeSet,
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
    package_main_code: over.main,
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
  assertEquals(crossMatch!.calc.package_main_code, "30803217");
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
  assertEquals(applied!.calc.package_main_code, "M1");
});

Deno.test("cross-PJ: sem main_code no codeSet, nada casa", () => {
  const calc = makeCalc({ main: "MAIN", included: ["A", "B"] });
  const m = pickPackageForAttendance([calc], new Set(["A", "B"]), new Set(["c"]));
  assertStrictEquals(m, null);
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
