---
name: Bypass de cache de regras em reanalise manual
description: Botão "Recalcular repasse / Reaplicar regras" envia force_fresh_rules=true → dispatch → orchestrate → analyze-payment (_force_fresh), pulando o ctx_cache (payment_job_context). Garante que edição de regra feita segundos antes seja lida do banco.
type: feature
---

Fluxo:
- `src/pages/CompanyAnalysis.tsx` (`reanalyzeGroup`) invoca `dispatch-payment-analysis` com `{ only_companies, force_fresh_rules: true }`.
- `dispatch-payment-analysis` propaga `force_fresh_rules` no body do orquestrador.
- `orchestrate-analysis` propaga `force_fresh_rules` no body de cada worker (`_force_fresh`) e na próxima página.
- `analyze-payment` lê `_force_fresh` do body; quando true, pula o bloco de leitura de `payment_job_context`. O snapshot ainda é gravado ao final (próximas páginas do mesmo job se beneficiam).

Motivo: ctx_cache reusa rules+rule_calculations entre workers do mesmo job. Em re-dispatch automático (multi-página) é correto; em reanalise MANUAL disparada logo após editar uma regra o usuário espera leitura fresca. Sem o bypass, o diff aparece como "0 itens recalculados" e o analista interpreta como "motor não viu minha edição".

NÃO remover esse flag sob argumento de performance — manual = 1 empresa = custo trivial.
