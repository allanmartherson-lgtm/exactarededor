---
name: Lote misto — override por item (Phase 1+2)
description: payment_items.payment_type_id (nullable) sobrescreve payment_type do lote; motor faz fallback; auto-classifica por TUSS+heurística no dispatch
type: feature
---

Quando um lote tem casos de tipos diferentes (ex.: lote de Consulta com itens de Procedimento, Centro Brasiliense), cada `payment_items` pode ter `payment_type_id` (nullable) sobrescrevendo o tipo do lote. Motor (`analyze-payment` / `calcItemMatches`) já resolve via `item.payment_type_id ?? payment.payment_type_id`.

**Fonte do override** (`payment_items.payment_type_source`):
- `null` ou `inherit` — usa o tipo do lote
- `auto_tuss` — auto-classificado por TUSS cadastrado em outro `payment_types` (tuss_default + tuss_codes_extra)
- `auto_heuristic` — auto-classificado por texto (procedimento|cirurgia|exame) quando o lote é consulta-like
- `manual` — analista escolheu via `PaymentTypeOverrideAction` (sempre vence)
- `report_cross*` — vem do cross-reference-parecer (intocável pelo auto-classify)

**Edge `auto-classify-payment-types`**:
- Rodada pelo `dispatch-payment-analysis` ANTES do orquestrador (await sincrono)
- Skipa itens com source ∈ {manual, report_cross, report_cross_dedup}
- Pode "limpar" overrides auto antigos voltando ao inherit quando o cadastro muda

**UI**:
- `AutoClassifiedBanner` na `CompanyAnalysis` mostra contagem por tipo de override
- `PaymentTypeOverrideAction` no detalhe de item permite override por item ou por atendimento + voltar ao padrão do lote

**Diferente de Parecer×Visita misto**: aquele fluxo usa relatório Tasy + `has_mixed_parecer`/`mixed_parecer_payment_type_id` no lote. Esse aqui é genérico por TUSS/heurística, sem relatório.
