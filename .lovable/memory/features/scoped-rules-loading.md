---
name: Carregamento de regras escopado por empresa
description: Filtro PostgREST que decide quais regras chegam ao motor quando analisa uma PJ — branches obrigatórias e regressões históricas
type: feature
---

Helper canônico: `supabase/functions/_shared/scopedRulesFilter.ts` (`buildScopedRulesOr`).
Teste de contrato (NUNCA adaptar para passar): `_shared/scopedRulesFilter_test.ts`.

Branches OBRIGATÓRIAS do OR (todas devem chegar ao motor):
1. `scope=master` — globais.
2. `scope=grupo` — TODAS, sem filtro por target_company_id (group_doctors segue o médico em qualquer PJ; `targetsGroup` decide).
3. `scope=especifica AND target_type=medico` — TODAS, sem filtro por target_company_id (regra de médico não amarra PJ; `targetsDoctor` decide por id/CRM/nome).
4. `scope=especifica AND target_company_id=<X>` — APENAS da PJ analisada.

NUNCA filtrar por `calculation_type` aqui — `informativo` no pai pode ter cálculos filhos calculáveis (1:N).

Regressão histórica (#5256, 18/06/2026): branch (3) faltava → "Repasse Dra Joana" (especifica/medico sem target_company_id) nunca era carregada e o motor caía na regra de grupo "Cirurgia Torácica". Toda alteração nesse OR DEVE rodar `deno test _shared/scopedRulesFilter_test.ts`.

Snapshot de cache (`payment_job_context`) recarrega regras SEM escopo (`hospital_id` apenas) — NÃO usar o helper lá.
