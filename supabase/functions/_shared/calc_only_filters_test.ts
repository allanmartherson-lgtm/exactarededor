// Garante que filtros restritivos vivem apenas no item de Cálculo.
// O motor não pode herdar codes/sectors/agreements/access_routes do nível Regra.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {

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

// Observação: a neutralização do seletor (`selectWinningRule`) para deixar de
// usar `procedure_codes`/`agreement_aliases`/`allowed_access_routes` no nível
// Regra é uma migração mais ampla do motor, fora do escopo desta validação.
// O `ruleFromCalcItem` já foi blindado para não vazar restritivos da Regra
// para a "regra efetiva" usada pelos calculadores.
