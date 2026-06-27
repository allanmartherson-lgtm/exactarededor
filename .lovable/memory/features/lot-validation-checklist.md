---
name: Checklist de validação no nível do lote
description: Checklist único por lote substitui o por empresa; sinais determinísticos + 1 chamada IA; drill-down por âncora #group-<id>; modo director enxuto.
type: feature
---
# LotValidationChecklist

## Por quê
Em lotes grandes, checklist por empresa era inviável (N×IA, N painéis). Movido para o nível do lote.

## Como funciona
- Edge function `payment-lot-checklist` (payment_id, audience: "validator" | "director")
- Sinais determinísticos primeiro: TUSS pendente, divergência bloqueante por empresa (vw_group_rule_totals + system_configurations.divergence_thresholds), itens sem regra, reprovados/alertas (com valor em risco), histórico de devolução por empresa.
- 1 chamada à Lovable AI Gateway (gemini-3-flash-preview) com tool emit_checklist para acrescentar 2-4 alertas adicionais que os sinais não captam.
- audience=director: filtra `baixa`, máximo 6 itens, sem checkboxes, foco em risco material.
- audience=validator: ordena por prioridade, máximo 10 itens, com checkboxes.
- analysis_mode='manual' retorna skipped (modo manual tem fluxo próprio).

## UI
- Componente `LotValidationChecklist` em `src/components/payment-detail/`.
- Montado em `PaymentDetail.tsx` ANTES do `ExecutiveSummaryCard` (mobile e desktop).
- Drill-down: itens com company_name viram link "Ir para <empresa>" que rola até `#group-<id>` na mesma página.
- Per-company `ValidationChecklist` foi removido de `PaymentGroupCard.tsx` (arquivo legado mantido por enquanto, mas não importado).

## Audiência derivada da fase do lote
- algum grupo aguardando_aprovacao + isDiretor → director (resumo executivo)
- algum aguardando_validacao → validator
- senão → não renderiza
