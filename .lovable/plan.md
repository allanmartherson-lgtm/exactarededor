# Conciliação bloqueante — regra × pedido de pagamento

Objetivo: impedir que um grupo (pagamento × empresa) avance para aprovação/pagamento quando o **bruto calculado pela regra** divergir do **bruto informado no pedido** além da tolerância.

## Como funciona hoje (curto)
- O motor (`analyze-payment`) calcula `expected_amount` por item e o agregado por grupo.
- O grupo (`payment_company_groups`) tem `bruto_total` (vindo do pedido/base hospitalar) e `last_approved_bruto`.
- A aprovação do diretor já existe via `company_group_approvals`, mas hoje não compara com a soma calculada pela regra.

## O que muda

### 1. Cálculo do "bruto da regra" por grupo
Nova view materializada `vw_group_rule_totals` que agrega por `payment_company_group_id`:
- `bruto_regra_total` = soma de `expected_amount` dos `payment_items` do grupo
- `bruto_pedido_total` = `bruto_total` do grupo (espelho)
- `diferenca` = `bruto_pedido_total − bruto_regra_total`
- `diferenca_pct`, `itens_sem_regra` (count), `itens_divergentes` (count)

### 2. Tolerância configurável
- Reaproveita `system_configurations.divergence_thresholds` (já existe) — adiciona chave `group_block_pct` (default 0,5%) e `group_block_abs` (default R$ 1,00).
- Override por hospital em `hospital_settings`.

### 3. Gate no banco (bloqueio real)
- Trigger `BEFORE UPDATE` em `payment_company_groups`: se o `status` mudar para `aprovado`/`lancado`/`pago` e houver divergência acima da tolerância, **`RAISE EXCEPTION`** com mensagem clara.
- Trigger só permite avançar se:
  - divergência dentro da tolerância, **ou**
  - existir um registro em `payment_group_reconciliation_overrides` (nova tabela) com `approved_by`, `justification`, `created_at`.

### 4. Nova tabela `payment_group_reconciliation_overrides`
Campos: `group_id`, `bruto_regra_snapshot`, `bruto_pedido_snapshot`, `diferenca_snapshot`, `justification`, `approved_by`, `created_at`, `hospital_id`. RLS: só director/admin do hospital insere; todos do hospital leem. Auditoria via `audit_log`.

### 5. UI — painel de conciliação no detalhe do pagamento
Novo componente `GroupReconciliationGate` exibido no topo do `PaymentDetail` por grupo:
- 3 cards: **Bruto pedido**, **Bruto regra**, **Diferença** (verde/amarelo/vermelho conforme tolerância).
- Lista colapsável dos itens divergentes (`expected_amount` ≠ `gross_amount`) e dos `sem_regra`.
- Quando divergente acima da tolerância:
  - Badge vermelho "Aprovação bloqueada — divergência R$ X".
  - Botão "Liberar com justificativa" (apenas role `director` ou `admin`) → modal com textarea obrigatória, grava override.
- Quando dentro da tolerância: badge verde "Conciliado".

### 6. Bloqueio também no frontend
- Botão "Aprovar grupo" / "Enviar para pagamento" fica desabilitado quando há divergência sem override, com tooltip explicando.
- Mensagem de erro do trigger é capturada e exibida em toast.

### 7. Página `/conciliacao` (já existe esqueleto)
- Acrescenta aba "Divergências bloqueantes" listando todos os grupos com gate ativo no hospital, com filtros por convênio/competência/severidade e link direto para o detalhe do pagamento.

## Entregáveis técnicos

```
supabase/migrations/<ts>_group_reconciliation_gate.sql
  - CREATE TABLE payment_group_reconciliation_overrides + GRANTs + RLS
  - CREATE OR REPLACE VIEW vw_group_rule_totals
  - CREATE FUNCTION check_group_reconciliation_gate() + TRIGGER
  - Seed default thresholds em system_configurations

src/hooks/useGroupReconciliation.ts        (busca vw_group_rule_totals)
src/components/payment-detail/GroupReconciliationGate.tsx  (UI principal)
src/components/payment-detail/ReleaseDivergenceDialog.tsx  (modal de override)
src/pages/Conciliacao.tsx                  (aba "Divergências bloqueantes")
```

## Itens fora do escopo desta etapa
- PDF da validação (próxima etapa).
- Simulador em lote (próxima etapa).
- Reprocessamento automático após edição de regra (já coberto pelo motor existente).

## Riscos / decisões

- **Itens `sem_regra` contam como divergência?** Proposta: sim, mas com severidade própria ("sem_regra") — bloqueia até que a regra seja cadastrada ou o item seja explicitamente excluído da base. Se preferir tratar como warning não-bloqueante, dizer agora.
- **Tolerância default 0,5% ou R$ 1,00 (o que for maior).** Confirma?
- **Quem pode liberar override:** apenas `director` + `admin`. OK?
