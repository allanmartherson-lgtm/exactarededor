---
name: KPI de intervenção ignora lotes históricos
description: get_intervention_savings exclui payments.import_mode='historico'
type: constraint
---
Lotes com `import_mode='historico'` foram carregados apenas para compor DRE e não representam intervenção real do time. A RPC `get_intervention_savings` filtra esses pagamentos. **Why:** evita inflar economia/perda com ajustes que aconteceram fora do fluxo operacional do Exacta.
