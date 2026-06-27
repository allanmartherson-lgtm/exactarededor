---
name: Pool — retenção do hospital
description: Participante hospital_nao_paga é fatia retida como receita do hospital; não gera pagamento nem entra na DRE de pagamento
type: feature
---

## Conceito
Um pool de rateio sempre soma 100%. Parte dessa cota pode ficar **retida em caixa do hospital** — é receita do hospital, não pagamento a terceiro.

## Modelagem (`pool_participants.participant_type`)
- `company` → `company_id NOT NULL`. Gera recebível normal para a empresa.
- `hospital_nao_paga` → `company_id IS NULL` por definição. Representa a retenção. **Não gera pagamento**.

Constraint do banco impede outras combinações (constraint `pool_participants_check`).

## O que o motor faz com `hospital_nao_paga`
- `recalc-payment-pools`: calcula a quota (apenas para exibição/auditoria), cria um **grupo sintético** em `payment_company_groups` com `company_id=NULL`, `company_name = "<pool> — hospital (retido N%)"` e `total_amount=0`. Zero é proposital: não polui DRE.
- `apply-minimum-guarantee` e `compute-company-financials`: filtram `participant_type === "company"` antes de qualquer cálculo de garantia mínima ou DRE.

## DRE
A DRE do sistema é **DRE de pagamento** (mede o que sai para empresas/médicos). Retenção do hospital é **receita do hospital**, fora desse escopo. Nunca incluir a quota retida na DRE de pagamento.

## UI
- `PoolCalculationCard` mostra a linha como "Retenção do hospital (N%) · receita hosp." com badge "retido" e estilo discreto.
- Form de pool (`Pools.tsx`) tem botão dedicado "Adicionar retenção hospital" e a prévia rotula "receita hospital (não paga)".
- Soma de percentuais (company + hospital_nao_paga) deve sempre fechar 100%.

## Zeev
Conhecimento explicado em `zeev-executor` SYSTEM_PROMPT: quando o usuário perguntar onde foi parar a fatia "que sumiu", responder que é retenção do hospital — receita dele, fora da DRE de pagamento.

## Pegadinha histórica
Em análises anteriores essa linha foi diagnosticada como "participante fantasma com company_id NULL". Não é bug. É retenção intencional. NUNCA propor deletar o `hospital_nao_paga` nem realocar seu percentual para a empresa.
