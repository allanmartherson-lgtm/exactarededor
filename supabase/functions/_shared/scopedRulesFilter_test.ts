// Teste de contrato: garante que o filtro de carregamento de regras
// (`buildScopedRulesOr`) cobre TODOS os casos que o motor sabe resolver.
// Regressão histórica: a branch `especifica/medico` foi removida em refatoração
// e a regra "Repasse Dra Joana" deixou de ser carregada — caía na regra de
// grupo "Cirurgia Torácica" porque o SELECT nem trazia a regra do médico.
//
// Se algum desses asserts falhar, NÃO adapte o teste: o filtro está errado.

import { assertStringIncludes, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildScopedRulesOr } from "./scopedRulesFilter.ts";

const COMPANY_ID = "78837f29-cc44-40df-92ae-08e27a63968e";

Deno.test("scopedRulesOr — carrega regras master (globais)", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assertStringIncludes(orStr, "scope.eq.master");
});

Deno.test("scopedRulesOr — carrega TODAS as regras de grupo (motor decide via targetsGroup)", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assertStringIncludes(orStr, "scope.eq.grupo");
  // Não pode ter filtro adicional por target_company_id em grupo
  assert(
    !/scope\.eq\.grupo[^,]*target_company_id/.test(orStr),
    "grupo NÃO pode ser filtrado por target_company_id — group_doctors segue o médico em qualquer PJ",
  );
});

Deno.test("scopedRulesOr — carrega TODAS as regras especifica/medico (motor decide via targetsDoctor)", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assertStringIncludes(orStr, "and(scope.eq.especifica,target_type.eq.medico)");
  // Não pode amarrar regra de médico a target_company_id — médico fatura por
  // várias PJs e a regra dele NÃO carrega target_company_id.
  assert(
    !/target_type\.eq\.medico[^)]*target_company_id/.test(orStr),
    "regra especifica/medico NÃO pode ser filtrada por target_company_id",
  );
});

Deno.test("scopedRulesOr — carrega especifica/empresa SOMENTE da PJ em análise", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assertStringIncludes(orStr, `and(scope.eq.especifica,target_company_id.eq.${COMPANY_ID})`);
});

Deno.test("scopedRulesOr — NÃO filtra por calculation_type (informativo precisa entrar)", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assert(
    !/calculation_type/.test(orStr),
    "regra com calculation_type='informativo' no PAI pode ter cálculos filhos calculáveis — não pode ser descartada no SELECT",
  );
});

Deno.test("scopedRulesOr — escopo da empresa é interpolado corretamente", () => {
  const orStr = buildScopedRulesOr(COMPANY_ID);
  assertStringIncludes(orStr, COMPANY_ID);
});
