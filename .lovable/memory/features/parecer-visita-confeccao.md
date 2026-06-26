---
name: Confecção Parecer — classificação Parecer vs Visita
description: Como o motor decide Parecer/Visita em lotes confecção parecer; relatório classifica tipo, regra calcula valor
type: feature
---

Em lotes `analysis_mode=confeccao` + `payment_type.code` começando com `parecer`:

1. **Relatório de pareceres do Tasy é obrigatório no wizard** — sem ele, submit bloqueado.
2. **Especialidade é obrigatória em todo item** — modal `SpecialtyResolutionModal` força o preenchimento antes do INSERT (chave da decisão usa especialidade, não médico).
3. **Edge function `cross-reference-parecer`** roda automaticamente após INSERT do payment+items+report e faz, em ordem:
   - Marca `confirmed` quem bate no relatório (atendimento+médico+data), `not_found` caso contrário.
   - **Dedup intra-lote** por `(attendance_number, specialty, convenio_slug)` ordenado por procedure_date ASC: só rebaixa para Visita quando o item está no DIA IMEDIATAMENTE CONSECUTIVO ao parecer anterior (diffDays == 1). Gaps > 1 dia são interconsultas novas e permanecem como Parecer. Regra de negócio: Parecer é a 1ª avaliação; a partir do dia seguinte vira Visita de acompanhamento.
   - **Lookback cross-lote 1d** (apenas dia anterior): para cada candidato remanescente, busca em `payment_items` (mesmo hospital, mesma especialidade, mesmo atendimento, parecer confirmado ou tipo Parecer, reclassified_from_parecer=false, payment_id≠atual, procedure_date == curDay-1). Se acha, rebaixa para Visita. NÃO usa janela ampla (90d) — apenas consecutividade real.
4. **`payment_type_source`** registra a fonte: `report_cross` (cruzamento normal) ou `report_cross_dedup` (rebaixado por dedup/lookback). `manual` sempre vence — `PROTECTED_SOURCES` blinda overrides do analista.
   - `reclassified_from_parecer` é flag auxiliar de Visita rebaixada; nunca pode contradizer `payment_type_id`. Se o subtipo manual/base protegido for Parecer, o flag deve ficar `false`; se for Visita, `true`.
5. **Painel `ParecerCrossReferencePanel`** mostra os reclassificados em tabela dedicada com motivo legível (`manual_intervention_notes`).
6. **Cálculo de valor**: o relatório de parecer é SOMENTE classificador Parecer/Visita. Nunca grava `expected_amount`, nunca aprova `ai_status` e nunca cria aceite/intervenção manual automática para valorar. Depois do cruzamento, a reanálise aplica a regra vencedora filtrada por `payment_type_id`; o valor sempre vem da regra.

Coluna `payment_items.reclassified_from_parecer` (boolean, default false) + index parcial `ix_payment_items_parecer_lookback (hospital_id, specialty, procedure_date) WHERE parecer_evidence='confirmed'` aceleram o lookback.
