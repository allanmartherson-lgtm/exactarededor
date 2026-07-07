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
- Aplicada no loop de calc para `por_item`; para `por_atendimento` deixa `piso_metodo_vencedor=null` (pendente)
- `applyPisoPorAtendimento(results, items)` — post-pass agrupa por (rule_id, doctor_id, attendance_number), aplica `MAX(sum(convenio), piso)` e distribui pro-rata pelos itens quando piso vence; convênio zerado → divisão igual
- `AnalysisResult.piso_aplicado_valor` / `piso_metodo_vencedor` / `piso_escopo` propagam para writer

UI:
- `RuleCalculationsEditor.tsx`: bloco só quando `calculation_type === 'percentual_sobre_convenio'` — toggle, escopo, piso padrão, grid por função (4 funções canônicas)
- `ItemsDataGrid.tsx`: badge "Piso aplicado" / "Convênio > piso" no drawer expandido do item (bloco de cálculo utilizado)

Pendências conhecidas:
- Exportações (PDF do lote, xlsx, DRE, portal do médico) ainda não trazem coluna/linha de piso — só visível no drawer
- Sem coluna dedicada na tabela do grid (analista precisa expandir a linha para ver)

