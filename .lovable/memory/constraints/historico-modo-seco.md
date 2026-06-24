---
name: Histórico em modo seco
description: import_mode='historico' calcula valores/erros mas não contamina cadastro com aliases/aprendizados
type: constraint
---
Lote com `import_mode = 'historico'` roda o motor completo (regras, expected_amount, diferenca_regra, status do item, DRE), mas NÃO grava:
- `convenio_aliases` (auto) em `analyze-payment` — `drainLearnedAliases()` é descartado
- `doctor_aliases / convenio_aliases / sector_aliases` (auto) em `NewPayment` — bloco `learnAliasesFromResolvedRows` pulado

**Por quê:** bases antigas (abril/maio aprovados retroativamente) servem só para popular DRE e visualizar diferenças. Aprender aliases de dados ainda não auditados envenena lookups futuros. Avaliação de qualidade é feita no uso real (lotes correntes).

Grupos do lote histórico já nascem com status `pago` (skip de validação/aprovação/NF) — comportamento prévio mantido.
