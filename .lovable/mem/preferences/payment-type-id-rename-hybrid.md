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
- `payments.payment_type_id` (modelo do lote — alias do payment_model_id; trigger `sync_payments_type_columns` mantém em sincronia)
- `payments.mixed_parecer_payment_type_id` (subtipo parecer destino)
- `rules.payment_type_id` (filtro de regra)
- ~~`payout_models.payment_type_id`~~ — REMOVIDA na D3.c (jun/2026). Usar `payout_models.payment_model_id`.
- `companies.default_payment_type_id` (padrão da empresa)
- `company_financial_adjustments.payment_type_ids[]` (array de filtros)

Essas seguem para ondas futuras (D3+). NÃO criar fallback `?? payment_type_id` em código novo que toca payment_items ou rule_calculations — colunas não existem mais.

**How to apply:** Em código novo, ler/escrever sempre `item_type_id` / `item_type_source` para payment_items e rule_calculations. Para as demais tabelas, manter `payment_type_id` até a onda equivalente.
