---
name: Teste do motor vive em /regras
description: Simulação dry-run do motor determinístico sobre lote existente, promovida para tela dedicada
type: feature
---
Simulação do motor (dry-run sobre lote real) fica em `/regras?tab=teste-motor` (`src/pages/RuleEngineTest.tsx`), não dentro do PaymentDetail. Motivo: é ferramenta de regra, não ação de lote. PaymentDetail mantém apenas o item de menu que abre a página com `payment_id` pré-selecionado. Antes: `RuleTestModal` acoplado. Retirado 2026-07-05.

Regras críticas ao mexer nessa página:
- SEMPRE buscar snapshot de `ai_status`/`ai_findings.expected_amount` do banco no início da simulação. Nunca comparar contra props stale da tela — gera falso positivo (ex.: "acatado → alerta" em pacotes onde o antes era R$ 0).
- Paginar snapshot em blocos de 1000 (`db-max-rows` do PostgREST). O próprio `analyze-payment` já pagina em blocos de 1000 desde 2026-07-05 (substituiu `.limit(20000)` que truncava silenciosamente).
