---
name: Rename híbrido payment_type_id (Caso D, Wave 4)
description: Convenção de nomes camelCase pós-split item_types/payment_models; colunas DB ainda payment_type_id até Wave 5
type: preference
---

**Regra de naming (UI/camelCase apenas):**
- Variável/estado/prop que representa **tipo do ITEM** (Parecer/Visita/Cirurgia/Consulta/Bônus/Exames) → `itemTypeId`.
- Variável/estado/prop que representa **modelo de pagamento do LOTE** (Produção/Plantão/Remessa/Valor fixo) → `paymentModelId` (e `paymentModelMeta`).
- `paymentTypeId` (camelCase) está deprecado — não usar em código novo.

**Colunas do DB continuam `payment_type_id`** em:
- `payment_items.payment_type_id` (override item)
- `payments.payment_type_id` (tipo/modelo do lote)
- `rule_calculations.payment_type_id` (matcher de regra)
- `companies.default_payment_type_id`

Não renomear coluna em snake_case até Wave 5 (migração coordenada + view de compat). A leitura/escrita do banco SEMPRE usa o nome legacy `payment_type_id`.

**Why:** Evita ambiguidade na UI sem quebrar 100+ pontos de acesso ao banco. Migração de coluna é wave separada.

**How to apply:** Em código novo: nomear pela natureza (item vs lote). Ao tocar arquivos antigos: oportunisticamente renomear locais quando estiver editando por outro motivo; não fazer pass dedicado.
