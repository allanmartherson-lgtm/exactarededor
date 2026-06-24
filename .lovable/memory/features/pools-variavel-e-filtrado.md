---
name: Pools — deduções variáveis e escopo filtrado
description: Suporte a deduções por competência (ex: plantão fim de semana) e pools que capturam itens por filtro (visita absorvida pela PJ do pool independente do médico)
type: feature
---

## Deduções variáveis por competência
- `pool_deductions.valor_variavel boolean`: quando true, o motor ignora `valor` e busca em `pool_deduction_values` pela competência do lote.
- `pool_deduction_values(pool_deduction_id, competence_month, valor, observacao)` — UNIQUE por (dedução, mês).
- Trigger `pdv_invalidate_run`: ao INSERT/UPDATE/DELETE marca `pool_calculation_runs.invalidated_at` do pool+competência → analista precisa reprocessar. Sempre grava em `audit_log`.
- Sem valor cadastrado → motor bloqueia run com `invalidated_reason='valor_variavel_competencia_nao_cadastrado'` (sem default silencioso).
- UI: tela `/pools/:id/valores-mensais` (matrix mês × dedução, edição inline com observação).

## Pool com escopo filtrado
- `pools.escopo_producao` ∈ {`participantes`, `filtrado`}; `pools.filtros_captura jsonb` com `{tipo_ato_ids, setor_slugs, convenio_slugs, funcoes, doctor_include_ids, doctor_exclude_ids}`.
- Quando `filtrado`: motor busca `payment_items` pelo filtro (ignora `company_id`) e marca cada item com `payment_items.absorbed_by_pool_id` — médico/PJ real não recebe repasse, vai tudo para os participantes do pool.
- Bloqueio de duplicidade: `pool_item_claims(payment_item_id, competence_month) UNIQUE`. Se outro pool já reivindicou o item na competência, o run aborta com `invalidated_reason='item_duplicado_em_outro_pool'` + lista em `error_detail`.
- Auditoria: `pool_calculation_runs.captured_item_ids`, `competence_month`, `snapshot.variable_values_used`, `snapshot.filtros_captura`, `error_detail`.

## Onde mexer
- Motor: `supabase/functions/recalc-payment-pools/index.ts` (detecta escopo, resolve filtros, aplica claims, marca absorbed_by_pool_id).
- Cadastro: `src/pages/Pools.tsx` (radio de escopo + bloco de filtros + toggle "valor variável" + link para valores mensais).
- Valores mensais: `src/pages/PoolMonthlyValues.tsx` (rota `/pools/:id/valores-mensais`).
- Relatório: `src/pages/PoolsReport.tsx` (badges "Invalidado" e "N itens capturados").
