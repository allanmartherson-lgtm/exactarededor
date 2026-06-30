# Fase D — Cleanup definitivo do legacy `payment_types`

Hoje o motor inteiro ainda lê `payment_type_id` — os triggers da Fase B' apenas mantêm sincronia com `item_type_id`/`payment_model_id`. Levantamento atual: **42 arquivos**, ~280 referências (top ofensores: `types.ts`, `ItemsDataGrid`, `NewPayment`, `cross-reference-parecer`, `_shared/rulesEngine`, `analyze-payment`).

Fazer rename + drop num turno único é alto risco. Proponho dividir em **D1 (refactor reversível)** e **D2 (drop irreversível)**.

## Sub-fase D1 — Refactor do motor (não destrutiva)

Objetivo: zero leitura/escrita de `payment_type_id`/`payment_type_source`/`payment_types` no código. As colunas/tabela continuam vivas, populadas pelos triggers, como rede de segurança.

Mapeamento canônico (decidido item a item, não busca-e-substitui cego):
- `payment_items.payment_type_id` → `item_type_id`
- `payment_items.payment_type_source` → `item_type_source`
- `payments.payment_type_id` → `payment_model_id` (é modelo do LOTE)
- `rules.payment_type_id` → quando filtra item: `item_type_id`; quando filtra modelo de lote: `payment_model_id` (revisão caso a caso em `rulesEngine.ts`)
- `procedure_classifications.payment_type_id` → já existe `item_type_id`, remover leitura legacy
- `rule_calculations.payment_type_id` → `item_type_id` (adicionar coluna nova nessa migration, com backfill + trigger sync)
- `payout_models.payment_type_id` → `payment_model_id`

Arquivos por bloco (ordem de execução):

1. **Edge functions motor** — `_shared/rulesEngine.ts`, `_shared/calcOverlap.ts`, `analyze-payment`, `validate-payment`, `dispatch-payment-analysis`, `simulate-rule`, `simulate-rule-batch`, `recalc-payment-pools`, `apply-company-deductions`, `cross-reference-parecer`, `auto-classify-payment-types`, `convert-rules`, `zeev-executor`
2. **Hooks/lib frontend** — substituir `usePaymentTypes` por `usePaymentModels` (para lote) ou `useItemTypes` (para item) caso a caso; deprecar `usePaymentTypeMeta`; ajustar `src/lib/status.ts`
3. **UI pagamento** — `PaymentDetail`, `ItemsDataGrid`, `PaymentTypeOverrideAction`, `AutoClassifiedReviewSheet`, `AutoClassifiedBanner`, `MixedParecerRetroAction`, `MixedParecerSetupCard`, `PaymentModeSelectModal`, `ZeevRetroactiveGapsCard`
4. **UI regras** — `Rules.tsx`, `RuleCalculationsEditor`, `ImportCalculationsDialog`
5. **UI lançamento** — `NewPayment`, `NewManualPayment`, `NewManualPaymentComposicao`, `ManualPaymentEntry`
6. **UI análise** — `CompanyAnalysis`, `CreditosDebitos`, `CompanyFinancialAdjustmentsDialog`, `PayoutModels`
7. **Testes** — atualizar/remover `usePaymentTypeCodeSync.test`, `rulesEngine_test`, `calcOverlap_test`, `columnMapping.paymentTypeMeta.test`

Migration única no fim de D1:
- Adiciona `rule_calculations.item_type_id` + backfill + trigger sync bidirecional
- Mantém `payment_types` e colunas legacy intactas

Critério de saída D1:
- `rg "payment_type_id|payment_type_source|payment_types|usePaymentTypes|usePaymentTypeMeta" src supabase` retorna apenas `types.ts` (auto-gen) e arquivos de teste removidos
- Re-rodar `analyze-payment` em 3 pagamentos representativos: `rule_calculations` idêntico ao antes
- View `v_legacy_payment_type_divergence` continua zerada em `out_of_sync`

Pausa para você operar 1 ciclo e confirmar que nada quebrou.

## Sub-fase D2 — Drop irreversível

Migration única (só após "ok" explícito):
1. Drop triggers de sincronização da Fase B'
2. `ALTER TABLE payment_items DROP COLUMN payment_type_id, DROP COLUMN payment_type_source`
3. `ALTER TABLE payments DROP COLUMN payment_type_id`
4. `ALTER TABLE rules DROP COLUMN payment_type_id`
5. `ALTER TABLE rule_calculations DROP COLUMN payment_type_id`
6. `ALTER TABLE payout_models DROP COLUMN payment_type_id`
7. `ALTER TABLE procedure_classifications DROP COLUMN payment_type_id` (se ainda existir além de `item_type_id`)
8. `DROP VIEW v_legacy_payment_type_divergence, v_legacy_payment_type_orphans, v_legacy_payment_type_usage`
9. `DROP TABLE payment_types CASCADE`
10. Remove arquivos: `src/pages/PaymentTypes.tsx` (original), `src/hooks/usePaymentTypes.ts`, `src/hooks/usePaymentTypeMeta.ts`, `src/hooks/__tests__/usePaymentTypeCodeSync.test.tsx`, `src/hooks/usePaymentTypeCodeSync.ts`, `src/lib/__tests__/columnMapping.paymentTypeMeta.test.ts`

## Riscos conhecidos

- **38 órfãos** (`v_legacy_payment_type_orphans`): linhas onde o legacy não tem `item_type_id` equivalente claro (ex.: `parecer_adulto`). Em D1 essas linhas continuam funcionando via fallback. Em **D2 elas quebrarão** se não tiverem `item_type_id` resolvido antes. Precisa de decisão sua antes de D2: mapear esses 38 manualmente ou aceitar perda controlada.
- **100 correções** (`producao` → `consulta`): intencionais, sem ação necessária.

## O que preciso de você agora

Confirma esse encadeamento (D1 agora, pausa, D2 depois com sua aprovação explícita e tratamento dos 38 órfãos)? Se sim, sigo direto pra D1 começando pelas edge functions do motor.
