---
name: Diagnóstico de descompasso competência (modo produção)
description: Quando lote produção tem alto % de itens com data fora da competência, Zeev sugere mudar regime para remessa.
type: feature
---

## Regra
Quando `competence_regime = 'producao'`, comparar `procedure_date` de cada item contra a `competence_month` do lote. Se ≥20% dos itens tiverem data fora da competência (mês diferente), exibir banner:

> "Detectamos que X de Y itens (Z%) têm data de atendimento fora de {competência}. Esse lote parece ser uma **remessa** (envio agregando competências anteriores). Deseja mudar o regime para remessa?"
> [ Manter produção ]  [ Mudar para remessa ]

## Onde
- Componente `ProducaoDescompassoBanner.tsx` em `src/components/payment-detail/`.
- Renderizado em `PaymentDetail.tsx` logo abaixo do header do lote, apenas quando `competence_regime === 'producao'`.
- Threshold padrão: 20% (configurável via constante).

## Ação "Mudar para remessa"
- Update `payments.competence_regime = 'remessa'`.
- Re-dispara recompute (rateio passa a usar regra de competência do lote = regra de remessa).
- Toast confirma e fecha o banner.

## NÃO dispara quando
- Modo é remessa, manual, histórico ou confecção.
- Lote tem `competence_months` (lista) que cobre todas as datas dos itens.

## Justificativa
Analista pode escolher produção por engano em lote que na verdade é remessa (envio agregando meses anteriores). Sem esse diagnóstico, rateio e DRE saem em mês errado.
