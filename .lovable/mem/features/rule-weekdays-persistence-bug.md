---
name: Bug — weekdays/includes_holidays não persistem no formulário de regras
description: Formulário salva regra com weekdays={} mesmo quando o preset "Fim de semana" está selecionado, e includes_holidays não reflete o checkbox
type: feature
---

## Sintoma
Regras salvas pelo formulário aparecem no banco com `weekdays='{}'` (vazio) e às vezes `includes_holidays=false` mesmo quando a UI mostra:
- Dias/período = "Fim de semana (sáb/dom)"
- Checkbox "Incluir feriados" marcado

O motor interpreta `weekdays='{}'` como "qualquer dia", então bônus de fim de semana são pagos indevidamente em dias úteis.

## Impacto real
- 4 regras afetadas (2 duplicatas de Otorrino + 2 de CGeral/Digestivo no DF Star)
- 12 bônus pagos indevidamente em dias úteis (9 em abril/2026 + 3 em maio/2026)
- ~R$ 17,8k em pagamentos improcedentes já cobrados retroativamente

Correção manual dos 4 IDs feita em 11/07/2026 via migration.

## Tarefas
1. **UI (RuleFormStepper)** — validar antes do submit:
   - preset "Fim de semana" ⇒ enviar `weekdays=[0,6]`
   - preset "Dias úteis" ⇒ enviar `weekdays=[1,2,3,4,5]`
   - preset "Todos os dias" ⇒ enviar `weekdays=[0,1,2,3,4,5,6]` (nunca `[]`)
   - checkbox "Incluir feriados" ⇒ garantir bind em `includes_holidays`
   - Se preset ≠ "personalizado" e o array resolvido for `[]`, bloquear submit com erro.

2. **Motor (analyze-payment / rule engine)** — tratar `weekdays='{}'` como **inerte** (regra não aplicável a nenhum dia) em vez de "qualquer dia". Vazio ≠ curinga.

3. **Migração de sanidade** — script que rode uma vez em prod procurando regras com `weekdays='{}'` cadastradas depois de X data e alertar analista.

4. **Investigar duplicatas** — hoje temos 2 IDs iguais para cada regra (mesma nome, mesmo hospital). O form deveria bloquear salvar duplicata ou o processo de cadastro está criando registro extra em erro.

## Contexto histórico
Descoberto em 11/07/2026 durante investigação do lote de bônus do Dr. Jairo (BSB Otorrino, abril/2026). Ver conversa relacionada e `mem://features/bonus-rule-labeling-bug`.
