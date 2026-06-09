---
name: Conciliação retroativa em Pendências
description: Módulo de apuração de faltas alegadas pelo médico em competências anteriores, com cruzamento contra payment_items e geração de ajuste de complemento
type: feature
---
Em /pendencias há a aba "Conciliação retroativa" para apurar alegações do médico sobre meses passados:
- Analista cria apuração (médico + intervalo). Tabelas: retroactive_reconciliations + retroactive_reconciliation_items.
- Lista de itens alegados aceita 3 entradas: formulário linha a linha, upload .xlsx/.csv, colar texto. Tudo alimenta um único draft antes de rodar.
- Cruzamento via edge function run-retroactive-reconciliation: chave canônica `atendimento+TUSS(8d)` em payment_items do doctor_id na janela ±90d.
- Classificações: ok_pago, pago_a_menos (gap=expected-paid), nao_pago (sem match + valor alegado), pago_outro_mes (match fora do período), sem_lastro.
- Geração de complemento via generate-retroactive-adjustment: cria company_financial_adjustments(tipo=complemento_retroativo) na PJ ativa do médico via doctor_companies. Se houver múltiplas PJs ativas, exige company_id explícito. Marca apuração como concluida e grava adjustment_ids.
- Nunca recalcula regras retroativamente — usa expected_amount já gravado nos payment_items.
- Componente principal: src/components/retroactive/RetroactiveReconciliationsTab.tsx (lista + new + detail em estado interno).
