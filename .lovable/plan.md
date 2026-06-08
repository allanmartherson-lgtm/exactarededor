# Cancelamento de pagamento "não-devido"

## Conceito
Distinguir **3 ações** que hoje viram tudo "exclusão":

| Ação | Significado | Entra no KPI de intervenção? | Status no DB |
|---|---|---|---|
| **Excluir** (existente) | Erro/duplicidade — remove o registro | ❌ não | hard delete |
| **Devolver/Reprovar valor** (existente) | Diretor/supervisor pede correção de valor | ✅ sim | observação |
| **Cancelar pagamento** (NOVO) | Médico fatura externamente, contrato encerrado, glosa total, decisão jurídica | ❌ não, mas vai pro relatório de **leakage** | `status='cancelado'` + motivo |

## Backend (1 migration)

### Novo enum
```sql
CREATE TYPE payment_cancellation_reason AS ENUM (
  'medico_fatura_externamente',
  'contrato_encerrado',
  'glosa_total_quitada',
  'decisao_juridica',
  'duplicidade_externa',
  'outro'
);
```

### Colunas (idempotentes) em `payment_company_groups` E `payment_items`
- `cancelled_at timestamptz`
- `cancelled_by uuid` → `auth.users`
- `cancellation_reason payment_cancellation_reason`
- `cancellation_note text`
- `cancellation_reactivated_at timestamptz`
- `cancellation_reactivated_by uuid`

`payment_items` ganha também `is_cancelled boolean DEFAULT false` (já que não tem coluna de status).

### RPCs
- `cancel_company_group_payment(group_id, reason, note)` → seta status=`cancelado` + metadata, cancela em cascata todos os itens do grupo, registra `audit_log`.
- `cancel_item_payment(item_id, reason, note)` → seta `is_cancelled=true` + metadata. **Trigger** verifica: se todos os itens do grupo viraram cancelados, marca grupo como `cancelado` automaticamente.
- `reactivate_cancelled_group(group_id)` / `reactivate_cancelled_item(item_id)` → limpa cancelamento, registra reativação.
- Todas restritas a `analista | validador | diretor | admin` via `has_role`.

### Guard-rails (trigger BEFORE UPDATE)
- Bloqueia cancelar se já houver `gross_amount > 0` confirmado E `payment.status IN ('pago','lancado','arquivado')`.
- Bloqueia cancelar se houver NF emitida vinculada (`invoices` com `payment_id`+`company_group_id` em status `nf_recebida/nf_conciliada/lancado`).
- Reativação só permitida enquanto o lote ainda não foi `pago`.

### Impacto no KPI já existente
`get_intervention_savings` ganha filtros extras:
- `payment_items.is_cancelled = false`
- `payment_company_groups.status <> 'cancelado'`

Assim **garante que cancelamento não polui** o "Ajuste por intervenção".

### Nova RPC para o painel de leakage
`get_cancelled_payments_summary(start, end, hospital_id)` → retorna agregado por motivo + lista detalhada (grupo, empresa, médico, valor cancelado, autor, data, reativado?). Usado no novo card.

## Frontend

### Ações nas telas
- **`/pagamentos/:id`** (lote): botão "Cancelar pagamento desta empresa" em cada grupo, ao lado de "Excluir" — modal exigindo motivo (Select obrigatório) + nota livre. Tela mostra badge `Cancelado — motivo` em grupos/itens já cancelados, com botão "Reativar" (permissão checada por role).
- **`/pagamentos/:id/empresa/:groupId`** (CompanyAnalysis): botão "Cancelar item" por linha + bulk "Cancelar selecionados".

### Componentes novos
- `src/components/payment-detail/CancelPaymentDialog.tsx` — modal único (level=group|item).
- `src/components/payment-detail/CancelledBadge.tsx` — pill com motivo e tooltip do autor/data.

### Novo card de painel
`src/components/kpis/CancelledPaymentsCard.tsx` — irmão do `InterventionSavingsCard`, mostra:
- Valor total cancelado no período.
- Top 3 motivos com %.
- Link "Ver relatório" → nova página.

### Nova página
`src/pages/CancelledPayments.tsx` (rota `/relatorios/pagamentos-cancelados`, mesmas roles que ajustes):
- 3 KPIs (total cancelado, qtd grupos, qtd itens).
- Quebra por motivo (gráfico de barras simples).
- Tabela: data, lote, empresa, médico, valor, motivo, autor, status (cancelado/reativado).
- Export CSV.
- Item de menu em Relatórios.

### Lib pura
`src/lib/cancelledPayments.ts` — tipos + helpers (`summarize`, `groupByReason`, `toCsv`) + suite de testes.

## Pontos a confirmar antes de codar
1. **Motivos**: a lista acima cobre? Algum motivo extra (ex.: "médico desligado", "pagamento via folha CLT")?
2. **NF já lançada**: além de bloquear cancelamento, queremos botão "estornar NF antes de cancelar" ou o usuário lida fora do sistema? Sugiro **só bloquear com mensagem clara** nessa fase.
3. **Reativação parcial**: se eu cancelei o grupo inteiro e quero reativar só 1 item depois, faz sentido? Sugiro **não** — reativação sempre no mesmo nível do cancelamento (mantém auditoria limpa).

Com essas 3 respostas, executo migration + 3 RPCs + 4 componentes + página + testes em uma única leva.
