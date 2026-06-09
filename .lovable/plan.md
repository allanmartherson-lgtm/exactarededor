# Conciliação Retroativa em /pendencias

Módulo novo dentro de **Pendências** para apurar faltas de pagamento alegadas pelo médico em competências anteriores, cruzando a lista que ele enviou contra a base hospitalar histórica e os `payment_items` já pagos. O sistema classifica cada linha (já pago / pago a menos / não pago / não consta na base / pago em outro mês) e permite gerar um **ajuste de complemento** que entra no próximo pagamento.

## UX

A página `/pendencias` ganha **abas** no topo:

- **Pendências** (a tabela atual, sem mudanças)
- **Conciliação Retroativa** (nova)

Dentro da nova aba, dois níveis:

1. **Lista de apurações** — tabela com apurações abertas/concluídas (médico, período, status, qtd de itens faltantes, R$ total a complementar). Botão "Nova apuração".
2. **Detalhe da apuração** — wizard em 3 passos:
   - **Passo 1 — Escopo**: médico (autocomplete em `doctors`), intervalo de competência (de/até), empresa (opcional, ou todas as PJs do médico).
   - **Passo 2 — Lista do médico**: três sub-abas de entrada coexistindo:
     - *Formulário linha a linha* (Atendimento, Data, Paciente, TUSS, Função, Valor alegado opcional)
     - *Upload de planilha* (.xlsx/.csv com auto-mapeamento de colunas — reaproveita o parser de `parsePaymentFile.ts`)
     - *Colar texto* (textarea + parser heurístico por linhas/tabs/`;`)
     - As três alimentam a mesma lista temporária; analista revisa antes de rodar.
   - **Passo 3 — Resultado**: tabela classificada + ação final.

## Motor de cruzamento

Reaproveita a chave canônica do `PaymentConciliationModal`: `Atendimento + TUSS(8d) + nome do médico normalizado`.

Para cada linha alegada pelo médico, busca:
- nos `payment_items` no período (todos os pagamentos do médico/PJs no intervalo) → "já pago"
- na base hospitalar do período (`conciliation_bases` + `reconciliation_items`, ou na própria origem dos `payment_items` quando não houver base separada) → "consta na base"

Classificações de saída por linha:

| status | regra |
|---|---|
| `ok_pago` | match em payment_items com valor ≈ esperado |
| `pago_a_menos` | match em payment_items com `gross_amount < expected_amount` (usa `diferenca_regra`) |
| `nao_pago` | consta na base no período mas sem `payment_items` correspondente |
| `pago_outro_mes` | match em payment_items fora do intervalo informado mas próximo |
| `sem_lastro` | alegação do médico não bate com nenhuma linha da base nem com pagamento |

Card-resumo no topo: total alegado, total já pago, **total a complementar** (soma de `nao_pago` + delta de `pago_a_menos`), itens sem lastro.

## Ação final — ajuste de complemento

Botão "Gerar ajuste" no Passo 3:
- Cria um `company_financial_adjustments` (tipo `complemento_retroativo`) por PJ vinculada ao médico (via `doctor_companies`) com o somatório dos itens `nao_pago` + delta de `pago_a_menos`.
- Salva os itens detalhados em `retroactive_reconciliation_items` (nova tabela), ligados ao adjustment, para auditoria.
- Marca a apuração como `concluida`.
- O ajuste entra automaticamente no próximo pagamento via fluxo existente de `apply-company-deductions` (já consome `company_financial_adjustments`).

## Detalhes técnicos

### Tabelas novas (migration única)

- `retroactive_reconciliations`: `id`, `hospital_id`, `doctor_id`, `period_start date`, `period_end date`, `status` (`em_analise|concluida|cancelada`), `created_by`, `summary jsonb` (totais), `adjustment_ids uuid[]`, timestamps.
- `retroactive_reconciliation_items`: `id`, `reconciliation_id`, `attendance`, `tuss_code`, `procedure_date`, `patient_name`, `function`, `claimed_amount`, `paid_amount`, `expected_amount`, `gap_amount`, `payment_item_id` (nullable), `payment_id` (nullable), `classification` (enum acima), `source` (`form|upload|paste`), `raw jsonb`.
- GRANTs + RLS por `hospital_id` seguindo padrão dos demais.

### Edge function: `run-retroactive-reconciliation`
- Input: `{ reconciliation_id, items: [...] }`
- Para cada item: roda lookup nos `payment_items` (filtra `doctor_id`+período) e na base (`reconciliation_items` quando existir).
- Persiste em `retroactive_reconciliation_items` e atualiza `summary` no pai.
- Output: contagens por classificação + totais.

### Edge function: `generate-retroactive-adjustment`
- Input: `{ reconciliation_id }`
- Agrupa itens elegíveis por `company_id` (resolvido via `doctor_companies`).
- Insere `company_financial_adjustments` (um por PJ), grava `adjustment_ids` na apuração e fecha o status.

### Frontend

- `src/pages/Pendencias.tsx`: refactor pra introduzir `<Tabs>` mantendo o conteúdo atual em "Pendências".
- `src/pages/RetroactiveReconciliations.tsx` (lista + criação).
- `src/pages/RetroactiveReconciliationDetail.tsx` (wizard 3 passos).
- `src/components/retroactive/ClaimEntryForm.tsx`, `ClaimUpload.tsx`, `ClaimPaste.tsx`, `ResultTable.tsx`, `SummaryCards.tsx`.
- Reaproveita `parsePaymentFile.ts` (auto-mapper) e helpers de normalização (`normalizeCode`, `normName`) já usados no `PaymentConciliationModal`.
- Rotas: `/pendencias?tab=retroativa`, `/pendencias/retroativa/nova`, `/pendencias/retroativa/:id`.

### Não-objetivos (fora do escopo desta entrega)

- Notificação automática ao médico do resultado (pode virar pendência depois, mas não nesta versão).
- Recalcular regras de repasse retroativamente — usa o `expected_amount` já gravado nos `payment_items`/base.
- Edição/refinamento do parser de planilha além do que já existe em `parsePaymentFile.ts`.

## Entregáveis

1. Migration com as 2 tabelas + GRANTs + RLS.
2. Refactor `Pendencias.tsx` para tabs.
3. Páginas + componentes de listagem, wizard e resultado.
4. 2 edge functions (`run-retroactive-reconciliation`, `generate-retroactive-adjustment`).
5. Memória do projeto atualizada com a regra do novo módulo.

Se aprovar, executo nessa ordem: migration → edge functions → frontend.