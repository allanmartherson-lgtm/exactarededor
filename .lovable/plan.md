## Objetivo

Habilitar o modo confecção para lotes do tipo **Parecer**: o analista sobe na criação do lote DUAS bases (Tasy + relatório de pareceres do Tasy), o sistema cruza, classifica cada item como parecer confirmado ou visita, e calcula o repasse usando o valor do convênio (já que não existe `gross_amount`/valor ajustado no modo confecção).

## Fluxo do usuário

1. Analista entra em "Novo pagamento" → escolhe Parecer + modo **Confecção**.
2. Wizard exibe **duas áreas de upload lado a lado**:
   - **Base Tasy** (obrigatória) — planilha de atendimentos/médicos como hoje.
   - **Relatório de Pareceres do Tasy** (obrigatório no modo confecção parecer) — mesmo arquivo aceito hoje pelo `ParecerReportCard`.
3. Após o parse das duas bases, mostra um painel resumo:
   - X atendimentos na base Tasy
   - Y linhas no relatório de parecer
   - Z atendimentos com match (vão como **parecer confirmado**)
   - W sem match (vão como **visita**)
4. Analista cria o lote. No backend acontece em sequência:
   - INSERT do payment (`analysis_mode=confeccao`, `confeccao_status=em_confeccao`).
   - INSERT dos `payment_items` (base Tasy).
   - INSERT do `payment_parecer_reports` + `payment_parecer_report_rows` (relatório).
   - Chama `cross-reference-parecer` para marcar `parecer_evidence` e ajustar `payment_type_id` por item (Parecer vs Visita).
   - Dispara o motor de cálculo (que em confecção já usa `procedure_amount` como base de cálculo do repasse).
5. PaymentDetail abre normalmente em modo confecção, com a aba/painel de evidência de parecer já preenchida.

## Regras de cálculo no modo confecção parecer

- Motor permanece com a lógica de confecção atual: `expected_amount` é calculado pela regra cadastrada (Parecer ou Visita), usando `procedure_amount` (valor convênio) como base.
- Não há `gross_amount` — nada muda aqui.
- Itens **sem regra cadastrada** ficam `sem_regra` e o botão **Finalizar confecção** fica bloqueado até zerar essa contagem (igual fluxo confecção atual, sem afrouxamento).

## Mudanças técnicas

### Frontend — `src/pages/NewPayment.tsx`

- Quando `analysisMode === "confeccao"` e o `payment_type` selecionado tem `code` começando com `parecer` (parecer_adulto, parecer_pediatria etc.), renderizar um segundo `<FileUploadArea>` para o relatório de parecer, com parser reaproveitado do `ParecerReportCard` (extrair `parseParecerWorkbook` para `src/lib/parseParecerReport.ts`).
- Estado novo: `parecerFile`, `parecerRows`, `parecerMapping`, contadores de match preview (calculado client-side com a mesma chave `atendimento + crm/nome + data` do edge function).
- Validação no submit: bloqueia criação se o relatório não estiver anexado.
- Após o `INSERT` do payment + items, antes do `dispatch-payment-analysis`:
  1. INSERT em `payment_parecer_reports` (+`row_count`, hash, etc.) e batch INSERT em `payment_parecer_report_rows`.
  2. `supabase.functions.invoke("cross-reference-parecer", { body: { payment_id, trigger_reanalysis: false } })` aguardando 202.
  3. Em seguida `dispatch-payment-analysis` como hoje.
- Remover o gate `missing_parecer_report` no caminho confecção parecer só após o upload bem-sucedido; se o usuário pular (não vai conseguir, validação trava antes), mantém o bloqueio.

### Library — `src/lib/parseParecerReport.ts` (novo)

- Extrair de `ParecerReportCard.tsx`:
  - `normalizeCrm`, `parseExcelDate`, `sha256Hex` (já existem em utils — reaproveitar de lá se houver).
  - Função `parseParecerWorkbook(file, mapping)` → `{ rows: ReportRowInput[], period_start, period_end, hash, source_filename, row_count }`.
- `ParecerReportCard` passa a importar daqui (sem mudança de comportamento).

### Component — `src/components/payment-wizard/ParecerReportUploadArea.tsx` (novo)

- Mini-card com upload + auto-mapping + botão "Configurar colunas" (reusa `ParecerColumnMappingDialog`).
- Emite via prop `onParsed({ rows, period_start, period_end, hash, filename })`.
- Exibe contadores de pré-match contra a base Tasy quando `tasyRows` é passado.

### Backend — `supabase/functions/cross-reference-parecer/index.ts`

- Nenhuma mudança funcional necessária — já marca `parecer_evidence` e reclassifica `payment_type_id` por item. Validar apenas que o caminho `trigger_reanalysis=false` é seguro quando chamado antes do primeiro `dispatch-payment-analysis` (o dispatch posterior recalcula com os novos `manual_intervention_reason_id` já aplicados).

### Motor — sem mudança

- O cálculo de regras Parecer/Visita já roda em confecção. O cruzamento prévio só ajusta `payment_type_id` por item, fazendo o motor escolher a regra certa.

## Bloqueio de finalize

- `finalize_confeccao` (já implementado) bloqueia quando há `applied_calc_method IS NULL` / `applied_rule_id IS NULL`. Comportamento mantido — itens sem regra Parecer ou Visita cadastrada barram a finalização.
- Adicionar mensagem específica no painel ConfeccaoAuditPanel quando o tipo do lote é Parecer: "X itens sem regra de Parecer/Visita — cadastre as regras antes de finalizar".

## Fora de escopo

- Não muda fluxo de análise (modo análise parecer permanece como hoje).
- Não muda parser do relatório nem o edge function.
- Não cria novo `payment_type` "Visita confecção" — reclassificação por item via `payment_type_id` continua sendo o mecanismo.
- Não toca regras de cálculo / motor.
