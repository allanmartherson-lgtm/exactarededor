---
name: cruzamento-nf-pedido
description: NF recebida bate contra bruto_total do payment_company_group; tolerância zero; divergência força status='divergente' e bloqueia avanço. Gate adicional (pedido × regra) dispara em aguardando_validacao + aguardando_aprovacao com DETAIL JSON + ReconciliationBlockDialog.
type: feature
---
- Referência do pedido: payment_company_groups.bruto_total (fallback total_amount).
- Tolerância: 0 (round 2 casas).
- Trigger BEFORE em invoices força status='divergente' e anota reconciliation_notes.
- Trigger BEFORE em payment_company_groups bloqueia nf_conciliada/lancado/pago se existir NF divergente vinculada.
- Quando valores voltam a bater, status 'divergente' rebaixa para 'recebida' automaticamente.

## Gate pedido × regra (check_group_reconciliation_gate)
- Trigger AFTER UPDATE em payment_company_groups; compara bruto_pedido_total (vw_group_rule_totals) vs bruto_regra_total.
- Disparado em transições para v_blocking_statuses: **aguardando_validacao** (envio analista→validador), aguardando_aprovacao (validador→diretor), aprovado*, pedido_nf_enviado, nf_recebida, nf_conciliada, lancado, pago.
- Limiar configurável por hospital via get_group_block_thresholds (block_pct + block_abs).
- Override auditado em payment_group_reconciliation_overrides com snapshot exato (regra+pedido) — qualquer recálculo invalida o override.
- RAISE EXCEPTION carrega DETAIL = jsonb com {kind:'reconciliation_block', group_id, payment_id, hospital_id, company_id, company_name, bruto_pedido, bruto_regra, diferenca, diff_pct, attempted_status}. supabase-js expõe em error.details.
- Parser canônico: src/lib/parseReconciliationBlock.ts.
- UI: ReconciliationBlockDialog plugado em PaymentBatchActionsFooter (envio validador→diretor) e PaymentDetail.doSendForValidation (envio analista→validador) oferece 3 ações: devolver com motivo automático (return_groups_to_analyst, p_lot_level=false), liberar com justificativa (override via ReleaseDivergenceDialog) e abrir empresa pra inspeção.
- canRelease no ReleaseDivergenceDialog: validador + diretor + admin (analista nunca libera — corrige na origem).
- RAISE EXCEPTION em PL/pgSQL só conhece % posicional, NUNCA %.2f — sempre pré-formatar via to_char e injetar como string.
