## Contexto

O trigger `trg_audit_doctor_companies` foi criado só depois do batch de 03/06/2026. Resultado: nenhum rastro de quem/quando/como deletou vínculos naquele dia. O caso Luis Augusto (CRM 8182) provou que houve **deletes silenciosos** — a PJ Consultório recebia pagamentos antes do batch, sumiu do cadastro em 03/06, e só voltou porque o usuário recriou manualmente em 02/07.

Além do Luis, a análise cruzada identificou 4 outros médicos com PJs pagadoras que "sumiram" do cadastro (candidatos a restauração).

## Objetivos

1. **Reconstruir o que foi deletado** em 03/06/2026 usando as únicas evidências disponíveis (payment_items + backup se existir).
2. **Fechar o gap do audit_log** para que isso nunca mais aconteça sem rastro.
3. **Executar as reversões restantes** (11 vínculos verdes já validados, menos Luis Augusto).

## Fase 1 — Restaurar PJs deletadas pelo batch

Para os 4 candidatos identificados (Tiago Freitas, Antonio Jorge, Daniele Manera, Mario Netto):

- Validar com a analista se cada PJ pagadora é vínculo legítimo (mesmo padrão do Luis) ou exceção pontual.
- Se legítima: recriar `doctor_companies` (doctor_id, company_id, start_date = data do primeiro pagamento nesse hospital, `created_by` = user do sistema com nota "restauração pós-batch 20260603").
- Registrar cada recriação em `audit_log` com `action='restore_after_batch_20260603'` e diff apontando para os pagamentos-evidência.

## Fase 2 — Executar reversão dos 11 vínculos verdes

Já validados na análise anterior, menos o Luis Augusto. Executar em migração única:

- `UPDATE doctor_companies SET end_date = CURRENT_DATE, end_reason = 'reversao_import_indevida_20260603' WHERE id IN (...)`
- Trigger `trg_audit_doctor_companies` vai capturar cada mudança automaticamente.

## Fase 3 — Reforçar o audit_log para nunca mais falhar silenciosamente

O trigger existe hoje, mas há três lacunas:

**3.1 Verificar se o trigger dispara em TODAS as operações e não engole erros**

- Confirmar que existe trigger `AFTER INSERT OR UPDATE OR DELETE` em `doctor_companies`.
- Revisar o corpo da função: qualquer `EXCEPTION WHEN OTHERS THEN NULL` é proibido — deve ao menos `RAISE WARNING` para logs do Postgres. Se o insert do audit_log falhar, a operação principal deve rolar com aviso, nunca silenciar.

**3.2 Bloquear DELETE físico em `doctor_companies` (obrigar soft-delete)**

Vínculo médico↔PJ é dado financeiro sensível — não pode ser apagado fisicamente. Nova regra:

- Trigger `BEFORE DELETE` que bloqueia com erro claro: "DELETE físico proibido em doctor_companies — use end_date + end_reason".
- Exceção controlada: role `service_role` em migração explícita, se algum dia for necessário.

**3.3 Estender auditoria imutável para as outras tabelas de vínculo crítico**

Mesma cobertura para: `doctor_hospital_overrides`, `company_hospital_overrides`, `doctor_aliases`, `convenio_aliases`, `sector_aliases`. Se um batch corromper aliases, hoje também não temos rastro.

**3.4 Página de leitura do audit_log**

Analista deve conseguir ver o histórico de qualquer médico/PJ sem precisar de SQL. Rota `/admin/auditoria` com filtro por entity_type + entity_id + intervalo de datas, mostrando actor, ação e diff.

## Fase 4 — Prevenir batches destrutivos

O `import-wizard` já foi corrigido (diff em vez de delete-then-insert), mas para garantir que nenhuma outra rota do sistema faça o mesmo:

- Adicionar teste E2E `tests/e2e/import-wizard-no-destructive-delete.spec.ts` que roda import de amostra e assert: zero DELETEs em `doctor_companies` durante o batch.
- Adicionar tag `[destructive-batch-suspect]` em qualquer PR que toque `doctor_companies` sem passar por `end_date`.

## Ordem sugerida

1. Fase 3.1 e 3.2 primeiro (proteção — bloqueia novos estragos imediatamente).
2. Fase 1 (restauração dos 4, com confirmação da analista caso a caso).
3. Fase 2 (reversão dos 11 verdes).
4. Fase 3.3 e 3.4 (auditoria estendida + UI).
5. Fase 4 (guarda-corpo contra regressão).

## Aspectos técnicos

- Fases 1–3.3 são migrations SQL puras.
- Fase 3.4 é UI React + query em `audit_log` (paginada, filtros server-side).
- Fase 4 é teste Playwright novo + checklist de PR.

Quer que eu comece pela Fase 3.1/3.2 (proteção primeiro) ou prefere validar os 4 restaurar com a analista antes?
