
## Objetivo

Habilitar o **modo confecção** para lotes de Parecer com classificação automática Parecer vs Visita usando 3 sinais combinados: relatório de pareceres do Tasy (obrigatório), dedup por **paciente + especialidade + convênio**, e lookback de 7 dias entre lotes. Valor sempre vem da regra cadastrada (`valor_fixo` para Parecer / tabela convênio para Visita).

## Regra de classificação (determinística)

Para cada item da base Tasy, ordenado por `procedure_date` ASC dentro de `(paciente_id ou paciente_nome_normalizado, especialidade, convenio_id)`:

1. **Não consta no relatório de parecer** → `payment_type = Visita` (fim).
2. **Consta no relatório E é a 1ª ocorrência da tripla no lote E não houve parecer da mesma tripla nos últimos 7 dias (lotes anteriores do mesmo hospital)** → `payment_type = Parecer`.
3. **Consta no relatório mas já há parecer prévio (no lote ou nos 7d)** → `payment_type = Visita` + flag `reclassified_from_parecer = true` para o painel de auditoria.

A chave usa **especialidade**, não médico — equipes que se revezam continuam tratando o mesmo caso, então o 2º profissional da mesma especialidade faz Visita, não Parecer.

Manual sempre vence (memory `parecer-visita-subtype`).

## Fluxo do usuário

1. Novo pagamento → Parecer + modo **Confecção** → wizard mostra **dois uploads** (Base Tasy + Relatório de Parecer Tasy).
2. Após parse, painel resumo: X atendimentos, Y linhas no relatório, Z preview-Parecer, W preview-Visita, R reclassificados pelo dedup, **E itens sem especialidade**.
3. **Se houver itens sem especialidade** → modal bloqueante "Informar especialidade dos itens faltantes":
   - Lista os atendimentos sem `specialty`
   - Combobox de especialidade por linha (ou aplicar em massa para itens do mesmo médico/setor)
   - Submit do lote só libera quando todos têm especialidade
4. Criação do lote dispara, em ordem:
   - INSERT payment + items (com `specialty` resolvido)
   - INSERT `payment_parecer_reports` + rows
   - Edge function `classify-parecer-confeccao` (nova) faz dedup+lookback e grava `payment_type_id` por item
   - `dispatch-payment-analysis` (motor aplica regra `valor_fixo` para Parecer, tabela convênio para Visita)
5. PaymentDetail abre em modo confecção. Painel novo "Auditoria Parecer/Visita" mostra reclassificações com motivo ("já houve parecer da mesma especialidade em DD/MM no lote X").

## Mudanças técnicas

### Frontend

- **`src/lib/parseParecerReport.ts`** (novo) — extrai `parseParecerWorkbook` de `ParecerReportCard.tsx` (reuso, sem mudança de comportamento).
- **`src/components/payment-wizard/ParecerReportUploadArea.tsx`** (novo) — mini-card upload + mapping, emite `onParsed({ rows, period_start, period_end, hash, filename })`.
- **`src/components/payment-wizard/SpecialtyResolutionModal.tsx`** (novo) — modal bloqueante para itens sem `specialty`, com combobox por linha + ação "aplicar a todos do mesmo médico/setor".
- **`src/pages/NewPayment.tsx`**:
  - Quando `analysisMode==='confeccao'` E `payment_type.code` começa com `parecer` → renderiza `ParecerReportUploadArea`.
  - Pré-classificação client-side (mesma chave `paciente+especialidade+convenio`) para mostrar contadores no painel resumo.
  - Detecta itens sem especialidade → abre `SpecialtyResolutionModal` antes do submit.
  - Após INSERT payment+items+report → invoke `classify-parecer-confeccao` (aguarda 202) → invoke `dispatch-payment-analysis`.
- **`src/components/payment-detail/ParecerVisitaAuditPanel.tsx`** (novo) — lista itens com `reclassified_from_parecer=true` mostrando motivo (lote/data do parecer prévio).

### Backend

- **Edge function `classify-parecer-confeccao`** (nova) — recebe `{ payment_id }`:
  1. Carrega `payment_items` do lote + `payment_parecer_report_rows`.
  2. Para cada item, marca candidato a Parecer se bate no relatório (chave atendimento+médico+data, igual `cross-reference-parecer`).
  3. Dedup intra-lote: agrupa por `(patient_key, specialty, convenio_id)` ordenado por data ASC, 1º vira Parecer, demais Visita.
  4. Lookback 7d: para cada candidato a Parecer remanescente, busca em `payment_items` (mesmo hospital, `procedure_date` últimos 7d antes do item, `payment_type=Parecer`, mesma tripla). Se existe → vira Visita.
  5. UPDATE `payment_items.payment_type_id` + `parecer_evidence` (jsonb com `{source, prior_payment_id?, prior_date?, reason}`) + `reclassified_from_parecer` flag.
  6. NÃO recalcula (motor roda depois via `dispatch-payment-analysis`).
- **Migration**:
  - `ALTER TABLE payment_items ADD COLUMN reclassified_from_parecer boolean DEFAULT false`
  - Index parcial: `CREATE INDEX ix_payment_items_parecer_lookback ON payment_items(hospital_id, specialty, convenio_id, procedure_date) WHERE payment_type_id IN (SELECT id FROM payment_types WHERE code LIKE 'parecer%')` (acelera lookback 7d).
  - Sem mudança nas regras de cálculo — motor já trata `valor_fixo`.

### Motor

Sem mudança. Quando o item está com `payment_type_id=Parecer` e existe regra `valor_fixo` cadastrada (convênio+função+payment_type=Parecer), motor aplica os R$ 400. Quando `payment_type_id=Visita`, aplica tabela convênio normal.

Itens sem regra Parecer ou Visita cadastrada → `sem_regra` → bloqueia finalize (comportamento atual mantido).

## Bloqueios e validações

- Relatório de parecer **obrigatório** no modo confecção parecer — wizard trava submit se ausente.
- Especialidade **obrigatória** em todo item de lote parecer-confecção — modal força preenchimento antes do INSERT.
- `finalize_confeccao` continua bloqueando itens sem regra (memory `confeccao-vs-analise-status`).

## Fora de escopo

- Modo análise parecer (já funciona via `cross-reference-parecer`).
- Mudança no parser do relatório.
- Auto-aprendizado de especialidade a partir de TUSS+médico (futuro, requer base histórica grande).
- Lookback configurável por hospital (fixa 7d nesta entrega).

## Memory a atualizar após implementação

- Adicionar em `mem://features/parecer-visita-subtype`: "Confecção: classificação por paciente+especialidade+convênio com lookback 7d; especialidade obrigatória; relatório de parecer obrigatório; reclassificações vão para painel de auditoria."
