---
name: Classificação semântica de cancelamento
description: Cancelamento manual só conta como economia se motivo for de economia real; demais motivos vão para neutro
type: feature
---

Cancelamento de pagamento (item ou empresa) exige motivo obrigatório, separado em 2 grupos:

**Economia real** (entra no saldo Economia − Perda do relatório de intervenções):
- `economia_real` — regra dizia que não devia pagar
- `medico_fatura_externamente`
- `contrato_encerrado`
- `glosa_total_quitada`
- `decisao_juridica`
- `duplicidade_externa`

**Neutros** (aparecem no relatório de cancelados mas NÃO somam no saldo):
- `pago_em_outro_lote` — vai ser pago em outra competência
- `duplicidade_motor` — lançamento manual que o motor depois cobriu automaticamente
- `outro` — sem motivo claro, tratado como neutro por segurança

Itens sem `cancellation_reason` (cancelamentos legados anteriores à classificação) caem em "Neutro" até o analista classificar.

**Arquivos canônicos:**
- `src/lib/cancelledPayments.ts` — enum, labels, `ECONOMIA_REAL_REASONS`, `isEconomiaRealReason()`, `REASON_GROUPS` para UI
- `src/lib/interventionSavings.ts` — `isCancellationNeutral()`, `classifyItem()`, `summarizeItems` com campo `neutro`
- `src/components/payment-detail/CancelPaymentDialog.tsx` — Select com grupos visuais + aviso semântico ao escolher motivo
- `src/pages/InterventionAdjustments.tsx` — KPI com 4 cards (Economia / Perda / Neutro / Saldo), enrich dos `cancellation_reason` via consulta a `payment_items`
- Migration: `payment_cancellation_reason` enum com os 9 valores

**Limitação atual:** RPC `get_intervention_savings` não retorna o motivo — o frontend faz query complementar em `payment_items` para enriquecer. Se a RPC for ampliada no futuro para incluir o motivo, remover o `enrichItemsWithCancellationReasons` da página.
