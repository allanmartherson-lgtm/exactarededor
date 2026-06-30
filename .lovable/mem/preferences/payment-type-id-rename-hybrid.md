---
name: Naming pós-Fase D — item_type_id vs payment_model_id
description: Convenções de naming após o cutover D2; payment_items e rule_calculations não têm mais coluna legacy
type: preference
---

**Status (Fase D2, jun/2026):** colunas `payment_type_id` / `payment_type_source` foram REMOVIDAS de:
- `payment_items` (substituídas por `item_type_id` / `item_type_source`)
- `rule_calculations` (substituída por `item_type_id`)

Triggers e funções de sync (`sync_payment_items_type_columns`, `sync_rule_calculations_item_type`, `_resolve_*`) também foram removidos.

**Regra de naming canônica:**
- Variável/coluna que representa **tipo do ITEM** (Parecer/Visita/Cirurgia/Consulta/Bônus/Exames) → `item_type_id` / `itemTypeId`.
- Variável/coluna que representa **modelo de pagamento do LOTE** (Produção/Plantão/Remessa/Valor fixo) → `payment_model_id` / `paymentModelId`.

**Colunas DB que AINDA usam `payment_type_id` (não migradas):**
- `payments.payment_type_id` (modelo do lote — coluna `payment_model_id` já existe e é mantida em sincronia pelo trigger `sync_payments_type_columns`)
- `payments.mixed_parecer_payment_type_id` (subtipo parecer destino)
- ~~`rules.payment_type_id`~~ — REMOVIDA na D3.b (jun/2026). Junto saíram `rules.payment_model_id` e o trigger `sync_rules_type_columns` (ambas eram não-usadas; filtro por tipo vive em `rule_calculations.item_type_id`).
- ~~`payout_models.payment_type_id`~~ — REMOVIDA na D3.c (jun/2026). Usar `payout_models.payment_model_id`.
- `companies.default_payment_type_id` (padrão da empresa)
- `company_financial_adjustments.payment_type_ids[]` (array de filtros)

**Status D3.a (jun/2026 — Opção 1 / refactor mínimo):** trigger ativo, coluna `payment_model_id` populada, MAS o código frontend NÃO foi migrado. Motivo: toda a UI usa `usePaymentTypes` / `usePaymentTypeMeta` e a variável `paymentModelId` (apesar do nome) guarda um `payment_types.id`. As tabelas `payment_types` e `payment_models` são SEPARADAS (joinadas só por `code`), então trocar `INSERT { payment_type_id }` por `{ payment_model_id }` daria FK violation. Cutover completo (drop da legacy) depende de migrar consumidores para `usePaymentModels` / `payment_models.id` — onda futura (D3.e).

**Status D3.d (jun/2026 — no-op de código):** mesma armadilha do D3.a. As três colunas restantes (`companies.default_payment_type_id`, `payments.mixed_parecer_payment_type_id`, `company_financial_adjustments.payment_type_ids[]`) guardam `payment_types.id` porque os selects que populam (`ItemsDataGrid → companies.update`, `MixedParecerSetupCard`, `CompanyFinancialAdjustmentsDialog`) usam `usePaymentTypes`. Para virar `*_item_type_id` / `payment_model_ids[]` é preciso primeiro migrar a UI para `useItemTypes` / `usePaymentModels` e reescrever os IDs armazenados (mudança de FK alvo, não rename). Postergado para a mesma onda D3.e.

Essas seguem para ondas futuras (D3+). NÃO criar fallback `?? payment_type_id` em código novo que toca payment_items ou rule_calculations — colunas não existem mais.

**How to apply:** Em código novo, ler/escrever sempre `item_type_id` / `item_type_source` para payment_items e rule_calculations. Para `payments`/`companies`/`company_financial_adjustments`, manter `payment_type_id` até a onda D3.e (a UI ainda opera em payment_types.id).
