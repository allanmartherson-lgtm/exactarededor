---
name: Piso por procedimento (mínimo garantido)
description: Percentual do convênio com piso mínimo por função — MAX(convenio, piso) aplicado no motor
type: feature
---

Feature liga em `rule_calculations` quando `calculation_type='percentual_sobre_convenio'` e `piso_habilitado=true`.

Colunas (rule_calculations):
- `piso_habilitado boolean default false`
- `piso_escopo text CHECK ('por_item'|'por_atendimento')` — por_atendimento ainda cai em por_item com alerta
- `piso_valor_padrao numeric` — fallback quando função não está na lista
- `piso_por_funcao jsonb` — `[{ role, valor, label? }]` (roles canônicas do classifyDoctorRole)

Colunas (payment_items):
- `piso_aplicado_valor numeric` — R$ do piso vigente para o item
- `piso_metodo_vencedor text CHECK ('convenio'|'piso')` — quem venceu o MAX

Motor (`supabase/functions/_shared/rulesEngine.ts`):
- `resolvePisoForRole(c, doctorRole)` — pura, prioriza função > padrão, ignora zero/negativo
- Aplicada no loop de calc (`applyCalculationSingle` retorna primeiro, wrapper faz MAX depois)
- `AnalysisResult.piso_aplicado_valor` / `piso_metodo_vencedor` propagam para writer

UI (`src/components/rules/RuleCalculationsEditor.tsx`):
- Bloco aparece somente quando `calculation_type === 'percentual_sobre_convenio'`
- Toggle → mostra select de escopo, input de piso padrão, grid por função (4 funções canônicas)

Pendências conhecidas:
- Escopo `por_atendimento` ainda não faz agregação real — motor emite alerta e trata como `por_item`
- Badge visual no card do item ("Piso R$ X venceu") ainda não implementado
