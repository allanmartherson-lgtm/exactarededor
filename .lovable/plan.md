# Exceção do cálculo por item

Quando uma regra tem um cálculo marcado com **Tipo de pagamento = Parecer** (ou outro), o analista vai poder, **linha a linha**, marcar o item como "Exceção do cálculo". Isso faz o motor ignorar aquele cálculo específico para aquele item e cair no próximo cálculo elegível da mesma regra (ex.: o "Regra Geral 100%" / percentual_convenio).

## Quando o botão aparece

- Apenas em itens cujo `applied_rule_id` aponta para uma regra que tem **pelo menos um cálculo** com `payment_type_id` setado **e cujo `payment_type_id` bate com o tipo do pagamento do item** (ou seja, o item foi resolvido pelo cálculo tipado, não pelo cálculo universal).
- Se a regra não tem cálculo tipado, ou se o item já caiu no cálculo universal, o botão **não aparece** — sem poluição visual.

## Efeito

- Item marcado → motor pula o(s) cálculo(s) com `payment_type_id` setado dentro daquela regra e tenta o próximo cálculo (tipicamente o universal / `percentual_convenio`).
- Se não houver cálculo alternativo elegível → item fica `sem_regra` com motivo `excecao_calculo_sem_fallback` (aviso para o analista).
- Marcação é **persistente por item**, sobrevive a re-análises (igual aos casos especiais).
- Toda mudança gera linha em `audit_log` e dispara recompute do grupo daquela PJ.

## UI

- **Onde:** dentro do card/linha do item no `PaymentConciliationModal`, ao lado do botão de "Caso especial" já existente.
- **Visual:** ícone pequeno (FilterX / SkipForward) com tooltip "Exceção do cálculo — pular regra tipada". Quando marcado: chip discreto âmbar no header da linha "Exceção: pulou Regra Parecer" + ícone destacado.
- **Sem nova coluna na tabela** — fica como ação no expand/detalhe da linha, exatamente como o caso especial.
- Modal de confirmação curto antes de marcar/desmarcar, com motivo opcional (texto livre).

## Mudanças técnicas

**Banco (`payment_items`)**
```
calc_exception_skip          boolean default false   -- flag
calc_exception_reason        text null               -- motivo opcional do analista
calc_exception_marked_by     uuid null               -- auth.uid()
calc_exception_marked_at     timestamptz null
calc_exception_skipped_calc_id uuid null             -- qual calc foi pulado (auditoria)
```
Migration + trigger leve que zera os outros 4 campos quando `calc_exception_skip` vira false.

**Motor (`rulesEngine.ts`)**
- `calcItemMatches`: novo guard antes do filtro de `payment_type_id` — se `item.calc_exception_skip === true` **e** `c.payment_type_id != null`, retorna `{ ok:false, reason:"item_calc_exception_skip" }`.
- Passar o flag para o item já lido em `analyze-payment`, `simulate-rule`, `simulate-rule-batch` (todos já lêem o resto das colunas — adicionar à seleção e ao mapper).
- Quando não há cálculo de fallback elegível para o item marcado: setar `applied_calc_method = 'sem_regra'`, `applied_rule_match_reason = 'excecao_calculo_sem_fallback'`.

**UI**
- `PaymentConciliationModal.tsx` (linha do item): novo botão pequeno, controlado por hook `useCalcExceptionEligibility(item)` que verifica:
  1. `item.applied_rule_id` setado
  2. fetch (cacheado) das `rule_calculations` da regra → existe alguma com `payment_type_id = item.payment_type_id`
- Hook novo `useToggleCalcException(itemId)`: faz update + invalidate + dispara recompute do grupo.
- Indicador visual no header do item quando marcado.

**Auditoria**
- `audit_log` entry com `entity_type='payment_item'`, `action='calc_exception_toggle'`, diff dos 5 campos.

## Arquivos

- `supabase/migrations/<novo>.sql` — colunas + trigger de sanitização
- `supabase/functions/_shared/rulesEngine.ts` — guard novo + tipo `RuleInput`
- `supabase/functions/analyze-payment/index.ts` — incluir campos no SELECT/mapper
- `supabase/functions/simulate-rule/index.ts` e `simulate-rule-batch/index.ts` — mesmo
- `src/components/payment-detail/PaymentConciliationModal.tsx` — botão + indicador
- `src/components/payment-detail/useCalcExceptionEligibility.ts` (novo)
- `src/components/payment-detail/CalcExceptionDialog.tsx` (novo, modal curto)
- `src/integrations/supabase/types.ts` — auto-regen

Posso seguir?
