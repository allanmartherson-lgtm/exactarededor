---
name: Conciliação retroativa em Pendências
description: Dois modos — "alegação do médico" (cruza com payment_items) e "TASY vs Repasse" (análise ad-hoc de arquivos externos)
type: feature
---
Em /pendencias → aba "Conciliação retroativa", o analista escolhe o modo ao criar a apuração:

**Modo 1 — alegacao_medico** (fluxo original, inalterado):
- Lista de itens alegados aceita 3 entradas: formulário linha a linha, upload .xlsx/.csv, colar texto.
- Cruzamento via edge function `run-retroactive-reconciliation`: chave canônica `atendimento+TUSS(8d)` em payment_items do doctor_id na janela ±90d.
- Classificações: ok_pago, pago_a_menos, pago_a_mais, nao_pago, pago_outro_mes, sem_lastro, tuss_divergente.
- Geração de complemento via `generate-retroactive-adjustment` em company_financial_adjustments(tipo=complemento_retroativo).
- Nunca recalcula regras retroativamente — usa expected_amount já gravado.

**Modo 2 — tasy_vs_repasse** (análise ad-hoc, sem upload de repasse):
- Compara base TASY (realizado, upload .xlsx/.csv) com o repasse **já gravado no sistema**: após o analista confirmar o mapeamento do TASY, o componente faz query automática em `payment_items` (filtros: doctor_id e/ou company_id da apuração + procedure_date entre period_start−90d e period_end+90d, limit 5000) e usa o resultado como fonte de repasse. Nada é persistido.
- Coluna usada como valor base de repasse: `procedure_amount` (valor 100% sem acordo). `expected_amount` e `gross_amount` carregam o acordo e NÃO são usados nesta comparação.
- Chave: `attendance_number + procedure_code(8d)`.
- TASY agregado: Qtd_TASY = SUM(qtd); Valor_TASY = SUM(valor_unit × qtd).
- Repasse agregado: Qtd_Pag_Total, N_Funcs = COUNT DISTINCT(doctor_role), Qtd_por_Func = Qtd_Pag_Total / N_Funcs, Valor_Pag = SUM(procedure_amount).
- Status: Não Pago | Div. Qtd / Valor | Div. Qtd | Div. Valor | Pago sem TASY | OK (oculto da tabela por padrão).
- Tolerâncias: |Dif_Qtd| ≥ 0.5 e |Dif_Valor| > 0.50.
- Filtro de exclusão de TUSS: campo livre na etapa de mapeamento do TASY (separado por vírgula); aplica nos dois lados.
- Modo armazenado em sessionStorage (`retro_mode__<recon_id>`) — não há coluna `mode` na tabela.

**Componentes:**
- `src/components/retroactive/RetroactiveReconciliationsTab.tsx` — list + new + DetailView que faz branch entre `AlegacaoDetailView` e `TasyVsRepasseView` (ambos inline).
- `src/components/retroactive/RetroactiveMappingWizard.tsx` — wizard genérico que aceita `targets: TargetField[]` custom; exporta `TASY_TARGETS` e `REPASSE_TARGETS`. Output passou a ser `Record<string,string>[]` + meta `{ mapping }` para reuso entre arquivos.
