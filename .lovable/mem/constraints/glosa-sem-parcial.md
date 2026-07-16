---
name: Glosa nunca é aplicada parcialmente
description: Se a PJ não tem líquido suficiente para cobrir a parcela inteira da glosa no lote, adia integralmente para o próximo ciclo.
type: constraint
---

**Regra reforçada pelo usuário (07/2026).**

O motor `apply-company-deductions` NÃO pode gravar `status='partial'` para glosas.
Se `parcela_prevista > capacidade_restante_da_PJ`, o débito rola inteiro para o
próximo ciclo (`status='postponed'`, `postpone_reason='insufficient_net'`) — não
consome capacidade, não fragmenta o histórico.

**Por quê:** parcial gerava resíduos difíceis de auditar e confundia analistas
que viam a glosa "aplicada" sem entender que sobrara saldo.

**Nota:** o valor de enum `partial` continua existindo no schema apenas para
compatibilidade com registros antigos; nenhum código novo deve emiti-lo.
