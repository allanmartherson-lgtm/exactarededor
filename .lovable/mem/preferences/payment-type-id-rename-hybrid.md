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

**Colunas DB que AINDA usam `payment_type_id` (legadas, vivem com colunas novas via trigger):**
- `payments.payment_type_id` ↔ `payment_model_id` (trigger `sync_payments_type_columns`)
- `payments.mixed_parecer_payment_type_id` ↔ `mixed_parecer_item_type_id` (trigger `sync_payments_mixed_parecer_columns`, D3.e.3)
- ~~`rules.payment_type_id`~~ — REMOVIDA D3.b (jun/2026).
- ~~`payout_models.payment_type_id`~~ — REMOVIDA D3.c (jun/2026).
- `companies.default_payment_type_id` ↔ `default_item_type_id` (trigger `sync_companies_default_type_columns`, D3.e.3)
- `company_financial_adjustments.payment_type_ids[]` ↔ `payment_model_ids[]` (trigger `sync_cfa_payment_model_ids`, D3.e.3 — IDs de item type órfãos são DROPADOS no map)

**Status D3.e.3 (jun/2026 — colunas novas + backfill + sync bidirecional):**
- Colunas canônicas adicionadas e populadas a partir das legadas via JOIN por `code`.
- Triggers bidirecionais ativos: UI pode continuar gravando na legada (forward sync) ou já migrar para a nova (reverse sync) — ambos lados ficam coerentes.
- 1 ajuste financeiro (id `f227ef1d…`) tinha `payment_type_ids=[parecer_adulto]` (item type, nunca casava com `payment_model_id` do lote — bug histórico). Mantido como `payment_model_ids = []` (opção 2: preserva comportamento "ajuste morto", explícito no campo novo).

**Status D3.e.2 (jun/2026 — consumidores migrados para colunas canônicas):**
- `CompanyFinancialAdjustmentsDialog` + `CreditosDebitos` + edge `apply-company-deductions`: lê/escreve `payment_model_ids` (fallback `payment_type_ids` na edge para linhas antigas). Picker restrito a `origin='payment_model'`.
- `MixedParecerSetupCard` (state field `item_type_id`) + `MixedParecerRetroAction` + `NewPayment`: escrevem `mixed_parecer_item_type_id`. Hook trocado para `useItemTypes`. Edge `cross-reference-parecer` lê canônica com fallback.
- `ItemsDataGrid`: catálogo agora vem de `item_types`; padrão da empresa grava `default_item_type_id`. `NewPayment` lê empresa preferindo `default_item_type_id`.
- `NewPayment` + `NewManualPayment` + `NewManualPaymentComposicao`: escrevem `payment_model_id` no insert do lote. `ManualPaymentEntry` lê preferindo `payment_model_id`.
- Helpers em `src/lib/paymentTypeResolvers.ts` ficaram criados (D3.e.1) mas não foram necessários nos consumidores — os triggers de sync + leituras com fallback bastaram.
- Próximo passo (D3.e.4): após validação em produção, dropar colunas legadas + triggers de sync.

Essas seguem para D3.e. NÃO criar fallback `?? payment_type_id` em código novo que toca payment_items ou rule_calculations — colunas não existem mais.

**How to apply:** Em código novo, ler/escrever sempre `item_type_id` / `item_type_source` para payment_items e rule_calculations. Para `payments`/`companies`/`company_financial_adjustments`, escrever SEMPRE na coluna canônica nova (`payment_model_id`, `mixed_parecer_item_type_id`, `default_item_type_id`, `payment_model_ids`); leituras podem usar fallback `?? <coluna legada>` enquanto D3.e.4 não dropar as legadas.
