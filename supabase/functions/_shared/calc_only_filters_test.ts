// Garante que filtros restritivos vivem apenas no item de Cálculo.
// O motor não pode herdar codes/sectors/agreements/access_routes do nível Regra.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  validateCalcOnlyFilters,
} from "./rulesEngine.ts";

Deno.test("validateCalcOnlyFilters: detecta restritivos legados no nível Regra", () => {
  const warnings = validateCalcOnlyFilters({
    id: "r1",
    name: "legado",
    active: true,
    scope: "master",
    procedure_codes: ["10101012"],
    sectors: ["cirurgia"],
    agreement_aliases: ["unimed"],
    allowed_access_routes: ["1a_via"],
  } as any);
  assertEquals(warnings.length, 4);
});

Deno.test("validateCalcOnlyFilters: regra sem restritivos no topo passa limpa", () => {
  const warnings = validateCalcOnlyFilters({
    id: "r2",
    name: "nova",
    active: true,
    scope: "master",
    procedure_codes: [],
    sectors: [],
    agreement_aliases: [],
    allowed_access_routes: [],
    calculations: [],
  } as any);
  assertEquals(warnings.length, 0);
});

Deno.test("motor: códigos restritivos no nível Regra não filtram — só os do Cálculo valem", () => {
  // Regra master com cálculo BÔNUS restrito ao código "AAA".
  // O nível Regra possui um código "ZZZ" legado (não deveria ter efeito).
  const rules = [
    {
      id: "r1",
      name: "Bônus FDS",
      active: true,
      scope: "master",
      severity: "info",
      calculation_type: "bonus",
      payment_term: "qualquer",
      applies_payment_types: null,
      // legado — deve ser ignorado:
      procedure_codes: ["ZZZ"],
      sectors: [],
      specialties: [],
      agreement_aliases: [],
      allowed_access_routes: [],
      calculations: [
        {
          id: "c1",
          calculation_type: "bonus",
          priority: 1,
          procedure_codes: ["AAA"],
          code_match_mode: "whitelist",
          bonus_amount: 1500,
          application_unit: "atendimento",
          time_mode: "qualquer",
        },
      ],
    },
  ];
  const item = {
    id: "i1",
    procedure_code: "AAA",
    procedure_date: "2026-05-09T10:00:00", // sábado
    attendance_number: "1",
    doctor_role: "cirurgiao",
    payment_amount: 0,
  };
  const ctx = {
    reference_date: "2026-05-09",
    payment_type: null,
    sectors: [],
    specialties: [],
  };
  const out = analyzePaymentItems([item] as any, rules as any, ctx as any);
  const first: any = Array.isArray(out) ? out[0] : (out as any).items?.[0];
  assert(first?.matched_rule_id === "r1", `esperava r1, recebeu ${first?.matched_rule_id}`);
});
