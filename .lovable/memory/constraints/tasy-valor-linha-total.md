---
name: TASY Valor é total da linha
description: Coluna "Valor" do relatório TASY já vem multiplicada pela quantidade — nunca multiplicar de novo
type: constraint
---
No relatório TASY (base de auditoria retroativa), a coluna mapeada como `tasy_valor_unit` representa o **total da linha** (valor × qtd já aplicado pelo próprio TASY). Nunca multiplicar novamente por quantidade em cálculos de auditoria, complementos, ou relatórios — isso inflacionaria totais.

- `valor_total_tasy` = valor bruto da linha (direto da planilha)
- `valor_unit_tasy` = `valor_total_tasy / qtd` (derivado, só display)
- Fixado em `RetroactiveReconciliationsTab.tsx` com `tasyValueIsLineTotal = true` (sem heurística automática, que falhava quando maioria era "não pago").
- Label do wizard: "Valor total da linha (valor × qtd, base 100%)".

**Por quê:** heurística anterior (`lineTotalDelta < unitValueDelta`) precisava de itens pagos comparáveis; em lotes com >50% "não pago" defaultava para unitário e multiplicava tudo por qtd (~7x inflado).
