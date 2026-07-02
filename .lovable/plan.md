# Ledger de intervenções + filtro de período

## Objetivo

Trocar a fonte do KPI "Valor ajustado por intervenção" de uma RPC que lê observações vivas para uma **tabela materializada no momento da aprovação do diretor**. Assim o card só reflete valor consolidado — nada em análise entra — e ganha um filtro de período baseado em quando o lote foi aprovado (data de trabalho), não na competência.

## Regras confirmadas

1. **Ajuste manual sem observação conta** como `ajuste_manual` (detectado por edição em `gross_amount` no audit log).
2. **Reprovação de lote já aprovado** → linhas do ledger ficam `reverted_at IS NOT NULL`. Somem do card, permanecem para auditoria.
3. **Filtro de período no card**: default = mês calendário atual (baseado em `approved_at`, não competência). Opções: mês atual, mês anterior, últimos 30/60/90 dias, custom.

## O que muda

### 1. Nova tabela `intervention_ledger`
Uma linha por item de lote aprovado. Colunas principais: `payment_id`, `item_id`, `approved_at`, `approved_by`, `valor_regra`, `valor_pago_final`, `delta`, `fonte`, `autor_id`, `hospital_id`, `reverted_at`, `reverted_reason`. Índices em `(hospital_id, approved_at)` e `(payment_id)`.

### 2. Trigger `on_payment_approval_change`
Em `AFTER UPDATE ON payments`:
- Se `status` mudou para `aprovado`: apaga linhas antigas do payment (segurança) e insere uma linha por item, classificando `fonte` na ordem: cancelamento → glosa → ajuste_manual → aceite_pago → aceite_esperado → sem_intervencao.
- Se `status` mudou **de** `aprovado` para outro: marca linhas com `reverted_at = now()` e `reverted_reason = novo_status`.

### 3. Refactor de `get_intervention_savings`
Passa a ler `intervention_ledger` filtrado por `approved_at BETWEEN p_start AND p_end AND reverted_at IS NULL AND hospital_id = ?`. Mantém o mesmo shape de retorno — front não muda.

### 4. Backfill único
Migration popula o ledger para todos os `payments` com `status='aprovado'` do hospital ativo (sem limite de tempo — histórico completo, é one-shot).

### 5. Filtro no card
`InterventionSavingsCard` ganha um dropdown compacto no header:
- **Mês atual** (default)
- Mês anterior
- Últimos 30 dias
- Últimos 90 dias
- Personalizado (abre popover com dois date pickers)

O período fica em `useState` local; o valor selecionado alimenta `p_start`/`p_end` na RPC. Rótulo do card atualiza junto ("Impacto em julho/2026", "Impacto nos últimos 30 dias" etc.).

## Detalhes técnicos

**Classificação da fonte no trigger** (por item):
```
IF item.cancelled_at IS NOT NULL          → 'cancelamento'
ELSIF EXISTS glosa_payment_applications   → 'glosa'
ELSIF audit_log tem UPDATE em gross_amount por diretor/validador → 'ajuste_manual'
ELSIF última observação acatada = 'aceitar_valor_pago'     → 'aceite_pago'
ELSIF última observação acatada = 'aceitar_valor_esperado' → 'aceite_esperado'
ELSIF ABS(delta) < 0.01                   → 'sem_intervencao'
ELSE                                       → 'ajuste_manual'  -- fallback
```

**Delta** = `valor_regra − valor_pago_final` (mantém a convenção atual: positivo = economia).

**Reversão** não deleta — preserva histórico para auditar oscilação aprovar/reprovar. Reaprovação: apaga linhas antigas e reinsere estado atual.

**Front:** só `InterventionSavingsCard.tsx` e `InterventionReports.tsx` recebem o dropdown de período; RPC signature preservada; testes existentes de `interventionSavings.ts` continuam válidos (lógica pura de resumo não muda).

## Passos de implementação

1. Migration: cria `intervention_ledger` (com grants + RLS por `hospital_id`), trigger de aprovação/reversão, refactor da RPC, backfill.
2. Ajuste do card: dropdown de período + label dinâmico.
3. Ajuste do relatório de intervenções: mesmo dropdown, aproveitando o hook existente.
4. Verificação: rodar `bunx vitest run interventionSavings` e conferir que valores do card batem com o histórico backfillado.

## Fora de escopo

- Não mexe em layout do card nem do relatório (só adiciona o filtro).
- Não altera semântica de cancelamento neutro (motivos operacionais continuam valendo dentro de `fonte='cancelamento'`).
- Não cria notificação de reversão — reversão silenciosa, some do card.
