---
name: Modelos de Repasse — composição genérica
description: Padrão para lançamentos manuais com fórmula (fisio, plantão fechado, oncologia); substitui telas/tabelas por especialidade
type: feature
---

Cada equipe que paga por composição (produção − glosa + acordos − TRD etc.) tem um **payout_model** cadastrado em `/cadastros?tab=modelos-repasse`, escopado por `(hospital_id, payment_type_id?, company_id?)`.

**Estrutura:**
- `payout_models` — receita versionada. `version` incrementa a cada salvamento; pagamentos guardam `payout_model_version` para auditoria estável.
- `payout_model_rubrics` — linhas ordenadas (`sort_order`). `kind` ∈ {base_producao, base_fixa, desconto_pct, desconto_valor, acrescimo_pct, acrescimo_valor, acrescimo_faixa, retencao_pct}. `incide_sobre` ∈ {bruto, subtotal_anterior, rubrica_especifica}. `param_key` aponta para `system_parameter_defs` (glosa/TRD herdam override).
- `payout_tier_tables` + `payout_tier_rows` — faixas reutilizáveis (atendimentos/produção/profissionais → valor).
- `payments.payout_breakdown` (jsonb) — memória do cálculo aplicado: `{model_id, model_version, rubrics:[{order,kind,label,value,...}], total_nf}`.

**Princípio:** nova especialidade = cadastrar 1 modelo + rubricas. Zero código. NÃO criar tabelas dedicadas (fisio_volume_tiers etc.) — usar `payout_tier_tables` genérica.

**Distinção vs Regras (rules/rule_calculations):** Regra calcula 1 linha de procedimento importado. Modelo monta a NF do mês inteiro num lançamento manual sem planilha item-a-item. Não substituem-se — convivem.

**Status atual:** Onda 1 entregue (estrutura + CRUD). Ondas pendentes: 2) aplicar modelo no lançamento manual com formulário gerado + PDF; 3) Portal/DRE lendo `payout_breakdown`; 4) motor automático.
