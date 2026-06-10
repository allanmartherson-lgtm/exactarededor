---
name: Conciliação retroativa em Pendências
description: Dois modos — "alegação do médico" (cruza com payment_items) e "TASY vs Repasse" (TASY externo + repasse do sistema)
type: feature
---
Em /pendencias → aba "Conciliação retroativa", o analista escolhe o modo ao criar a apuração:

**Modo 1 — alegacao_medico** (fluxo original, inalterado):
- Lista de itens alegados aceita 3 entradas: formulário linha a linha, upload .xlsx/.csv, colar texto.
- Cruzamento via edge function `run-retroactive-reconciliation`: chave canônica `atendimento+TUSS(8d)` em payment_items do doctor_id na janela ±90d.
- Classificações: ok_pago, pago_a_menos, pago_a_mais, nao_pago, pago_outro_mes, sem_lastro, tuss_divergente.
- Geração de complemento via `generate-retroactive-adjustment` em company_financial_adjustments(tipo=complemento_retroativo).
- Nunca recalcula regras retroativamente — usa expected_amount já gravado.

**Modo 2 — tasy_vs_repasse** (TASY externo + repasse do sistema):
- Compara base TASY (realizado, upload .xlsx/.csv) com o repasse **já gravado no sistema**: após o analista confirmar o mapeamento do TASY, o componente faz query automática em `payment_items` (filtros: doctor_id e/ou company_id da apuração + procedure_date entre period_start−90d e period_end+90d, limit 5000) e usa o resultado como fonte de repasse.
- Coluna usada como valor base de repasse: `procedure_amount` (valor 100% sem acordo). `expected_amount` e `gross_amount` carregam o acordo e NÃO são usados nesta comparação.
- Chave: `attendance_number + procedure_code(8d)`.
- TASY agregado: Qtd_TASY = SUM(qtd); Valor_TASY = SUM(valor_unit × qtd).
- Repasse agregado: Qtd_Pag_Total, N_Funcs = COUNT DISTINCT(doctor_role), Qtd_por_Func = Qtd_Pag_Total / N_Funcs, Valor_Pag = SUM(procedure_amount).
- Status TVR (nomes canônicos, gravados direto em `retroactive_reconciliation_items.classification` — não há CHECK constraint): `nao_pago`, `div_qtd_valor`, `div_valor`, `pago_a_mais`, `ausente_tasy`, `ok` (gravado como `ok_pago` por compatibilidade). Rótulos UI: "Não Pago", "Div. Qtd / Valor", "Div. Valor", "Pago a mais", "Ausente TASY", "OK". Div. Qtd isolada (qtd diverge mas valor bate) cai em OK — não é acionável e gera falso positivo em multi-segmento/vias de acesso.
- Tolerâncias: |Dif_Qtd| ≥ 0.5 e |Dif_Valor| > 0.50.
- Filtro de exclusão de TUSS: campo livre na etapa de mapeamento do TASY (separado por vírgula); aplica nos dois lados.
- Persistência: `summary.mode = 'tasy_vs_repasse'` identifica o modo; cada linha vai para `retroactive_reconciliation_items` com `source='tasy_vs_repasse'` e payload em `raw.tvr_result`. Não criar novas colunas para este modo. A cada reprocessamento o motor faz REPLACE completo dos itens (`DELETE WHERE reconciliation_id=? AND source='tasy_vs_repasse'` antes do INSERT) e SOBRESCREVE o `summary` do zero (preservando apenas `handoff` e `tvr_validation_history`) para evitar contadores defasados como `div_qtd` ou `pago_sem_tasy` de rodadas antigas.
- Contagem no wizard de mapeamento: badge mostra `arquivo = válidas + excluídas + descartadas` para o analista ver onde as linhas se perderam; expander lista os primeiros 10 descartes com o campo obrigatório faltante. Os totais (`tasy_file_totals`) e exemplos (`tasy_dropped_examples`) ficam persistidos no `summary` e rehidratam ao recarregar a tela.

**Componentes:**
- `src/components/retroactive/RetroactiveReconciliationsTab.tsx` — list + new + DetailView que faz branch entre `AlegacaoDetailView` e `TasyVsRepasseView` (ambos inline). `TasyVsRepasseView` faz `loadPaymentItems()` automaticamente após confirmar o mapeamento do TASY.
- `src/components/retroactive/RetroactiveMappingWizard.tsx` — wizard genérico que aceita `targets: TargetField[]` custom; exporta `TASY_TARGETS` (e `REPASSE_TARGETS` mantido para uso futuro, não usado pelo modo 2 atual).

**Encaminhamento → Glosa de auditoria (Caminho B):**
- Apuração com `doctor_id` (médico-único): glosa cai em 1 grupo com nome/CRM do `doctorInfo` resolvido do recon.
- Apuração só-PJ (`company_id` preenchido, `doctor_id` nulo): itens "a retirar" são agrupados por `matched_doctor_id` (gravado no `TvrResult` durante o `process()`, vindo do `payment_items.doctor_id` da chave; se múltiplos médicos na mesma chave, prefere o `doctor_id` cujo `doctor_role` casa com "Cirurgião Principal", senão o primeiro). Texto livre do TASY NUNCA é usado como chave de agrupamento.
- Modal renderiza grupos com checkbox por médico (default: todos marcados), parcelas aplicadas a todos. Itens sem `matched_doctor_id` aparecem como "não atribuíveis" e são ignorados.
- Execução: 1 `glosa_batches` para a apuração inteira; `glosa_items` inseridos por grupo com `doctor_name`/`doctor_crm` resolvidos da tabela `doctors` (não TASY); 1 RPC `create_glosa_debt_with_items` por grupo, sequencial. Falha em qualquer RPC → rollback total (apaga débitos criados via `glosa_debt_items.glosa_item_id` → `glosa_debts`, depois `glosa_items` e `batch`). Sem estado parcial.
- `canGerarGlosa` agora exige apenas PJ + ≥1 grupo com médico resolvido — não exige `doctor_id` no recon.

**Encaminhamento → Confecção (Caminho complementar):**
- Ao navegar para `/pagamentos/novo?modo=confeccao&retro=<id>`, a base de confecção deve ser materializada automaticamente como um bucket/planilha sintética; o analista não deve reenviar manualmente arquivo.
- Pré-carga inclui somente complementares: `nao_pago` + `div_valor`/`div_qtd_valor` com `dif_valor > 0.5`; itens a retirar seguem pela glosa, não entram na planilha complementar.
- Valor base da linha: `valor_total_tasy` para `nao_pago`; `dif_valor` positivo para divergência. Quantidade: `qtd_tasy` para não pago; diferença positiva de quantidade quando houver, senão 1. A coluna `Valor Procedimento` fica unitária (`total/qtd`) para o motor de confecção aplicar quantidade.
- Enriquecer médico/convênio/setor/PJ com `payment_items` quando houver `matched_payment_item_id`; se não houver, usar dados do `TvrResult` e a PJ da apuração. A tela deve preencher competência pelo período da apuração e categoria `pendencia`.
