---
name: cruzamento-nf-pedido
description: NF recebida bate contra bruto_total do payment_company_group; tolerância zero; divergência força status='divergente' e bloqueia avanço para nf_conciliada/lancado/pago. Triggers DB: enforce_invoice_amount_match (invoices) e block_group_advance_on_invoice_divergence (groups).
type: feature
---
- Referência do pedido: payment_company_groups.bruto_total (fallback total_amount).
- Tolerância: 0 (round 2 casas).
- Trigger BEFORE em invoices força status='divergente' e anota reconciliation_notes.
- Trigger BEFORE em payment_company_groups bloqueia nf_conciliada/lancado/pago se existir NF divergente vinculada.
- Quando valores voltam a bater, status 'divergente' rebaixa para 'recebida' automaticamente.
