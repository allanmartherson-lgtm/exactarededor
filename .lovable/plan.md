## Objetivo
Concluir a separação **payment_models** (modelos de lote: Produção, Plantão, Remessa, Valor Fixo) vs **item_types** (procedimentos: Consulta, Parecer, Visita, Cirurgia, Bônus, SADT, Cardio), migrando o motor inteiro para ler `item_type_id` / `payment_model_id` e removendo o legacy `payment_types` em segurança.

## Fase A — UI de cadastros (item 1 do plano)
Já entregue no turno anterior:
- Rotas `/payment-models` e `/item-types` (e aliases pt-BR) com CRUD completo
- Hub em `/payment-types` com abas
- Validações: TUSS único, default único, bloqueio de inativação do padrão

Nada novo aqui — só confirmação.

## Fase B — Motor: leitura dupla (não-destrutivo)
Cada consumidor passa a **preferir** `item_type_id`/`payment_model_id` e cai no legacy `payment_type_id` quando o novo estiver nulo. Sem nenhum DROP.

Edge functions (ordem):
1. `_shared/rulesEngine.ts` — helper `resolveItemType(item)` e `resolvePaymentModel(payment)`; toda checagem de "é Consulta / é Plantão / é Produção" passa pelo helper
2. `_shared/calcOverlap.ts` — chaves de overlap usam item_type_id
3. `analyze-payment` — matching de regra por (payment_model_id, item_type_id)
4. `validate-payment` — divergências por item_type_id
5. `dispatch-payment-analysis` — escolha de pipeline por payment_model_id
6. `simulate-rule` + `simulate-rule-batch`
7. `recalc-payment-pools` — pool por payment_model_id
8. `apply-company-deductions` — DRE
9. `cross-reference-parecer` — preserva manual/cross
10. `auto-classify-payment-types` — já migrado; revalidar

Frontend (mesma estratégia de leitura dupla):
- Hooks: `usePaymentTypes` deprecia, `useItemTypes` + novo `usePaymentModels` viram fonte
- `PaymentDetail`, `ItemsDataGrid`, `PaymentTypeOverrideAction`, `AutoClassifiedReviewSheet`, `AutoClassifiedBanner`, `MixedParecerRetroAction`, `CalcExceptionDialog`
- `Rules`, `ValidationRules`, `RuleCalculationsEditor`, `ImportCalculationsDialog`
- `NewPayment`, `NewManualPayment`, `NewManualPaymentComposicao`, `ManualPaymentEntry`
- `CompanyAnalysis`, `CreditosDebitos`, `CompanyFinancialAdjustmentsDialog`, `ZeevRetroactiveGapsCard`, `MixedParecerSetupCard`

Teste de aceite Fase B:
- Rodar `analyze-payment` em 3 pagamentos representativos (produção, plantão, parecer/visita misto) e comparar `rule_calculations` antes/depois — esperado: idêntico
- Atualizar `_shared/rulesEngine_test.ts` e `calcOverlap_test.ts`

## Fase C — Backfill de garantia + monitor
- Migration que faz `UPDATE` em qualquer `payment_items.item_type_id IS NULL` que ainda exista (já 0 hoje, mas garantir gatilho)
- Trigger `BEFORE INSERT` em `payment_items` e `payments`: se `item_type_id`/`payment_model_id` nulo, classifica automaticamente
- View `v_legacy_payment_type_usage` lista qualquer linha onde legacy ≠ novo → alarme

Aguardar 1 ciclo de uso real (você roda os processos do dia) e confirmar view zerada.

## Fase D — Cleanup (item 3, irreversível)
Só depois do "ok" explícito seu, em migration única:
1. `ALTER TABLE payments DROP COLUMN payment_type_id, DROP COLUMN payment_type_source`
2. Idem em `payment_items`, `rules`, `procedure_classifications`
3. `DROP TABLE payment_types CASCADE`
4. Remover hooks/páginas legacy (`PaymentTypes.tsx` original, `usePaymentTypes`, `usePaymentTypeMeta`, teste `usePaymentTypeCodeSync`)
5. Limpar campos de leitura dupla nas edge functions

## Estratégia de execução
Vou pedir aprovação **entre cada fase**, não fazer tudo num turno só. Motivos:
- Fase B sozinha edita ~25 arquivos e 9 edge functions — precisa de janela de teste sua antes de seguir
- Fase D é destrutiva e só deve rodar quando Fase C ficar limpa por pelo menos um ciclo operacional

## Próximo passo
Confirma esse encadeamento? Se sim, começo agora pela **Fase B** (leitura dupla no motor) e te devolvo para teste antes de partir pra C e D.
