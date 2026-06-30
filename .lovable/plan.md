## D3.e — Cutover final do legado `payment_type_id`

Esta é a onda que destrava o que D3.a e D3.d deixaram pendente. Foco em **migrar a UI** e **reescrever os IDs já gravados** antes de dropar colunas.

---

### Problema central

Hoje, três camadas convivem:

```text
payment_types  ──code──▶ payment_models   (modelo do LOTE: producao/plantao/remessa/...)
                └─code──▶ item_types      (tipo do ITEM: parecer/visita/cirurgia/...)
```

A UI inteira seleciona via `usePaymentTypes` e grava `payment_types.id` em colunas que conceitualmente são "modelo de lote" ou "tipo de item". Trigger de sync esconde a discrepância em `payments` (espelha em `payment_model_id`). Já em `companies.default_payment_type_id`, `payments.mixed_parecer_payment_type_id` e `company_financial_adjustments.payment_type_ids[]` não há espelho — UI e DB seguem em payment_types.

---

### Escopo (4 sub-ondas)

#### D3.e.1 — Hooks e helpers de leitura
Trocar os pontos de seleção da UI para as tabelas canônicas, mantendo escrita ainda no campo legado (modo de transição).

- `src/hooks/usePaymentTypes.ts` → manter, mas marcar deprecated; introduzir helper `resolvePaymentModelIdFromPaymentTypeId(pt_id)` e `resolveItemTypeIdFromPaymentTypeId(pt_id)` (lookup local via `code`).
- Garantir que `usePaymentModels` e `useItemTypes` retornam `{id, code, label}` no mesmo shape esperado pelos combos atuais.

#### D3.e.2 — Cutover por consumidor
Trocar combos + reescrever o valor selecionado para o id da tabela alvo.

| Consumidor | Hoje grava em | Alvo D3.e |
|---|---|---|
| `NewPayment.tsx` (linha 2493) — `payments.payment_type_id` | `payment_types.id` | `payments.payment_model_id` recebe `payment_models.id` direto |
| `NewManualPayment.tsx` (linha 88) | idem | idem |
| `NewManualPaymentComposicao.tsx` (linha 205) | idem | idem |
| `ManualPaymentEntry.tsx` (linha 118) — leitura | `payment_types.id` | passa a ler `payment_model_id` e expor `payment_models.id` |
| `MixedParecerSetupCard.tsx` — `payments.mixed_parecer_payment_type_id` | `payment_types.id` (subtipo parecer) | `payments.mixed_parecer_item_type_id` recebe `item_types.id` |
| `MixedParecerRetroAction.tsx` (linha 86) — idem | idem | idem |
| `ItemsDataGrid.tsx` (linha 1187) — `companies.default_payment_type_id` | `payment_types.id` | `companies.default_item_type_id` recebe `item_types.id` |
| `CompanyFinancialAdjustmentsDialog.tsx` + `CreditosDebitos.tsx` — `company_financial_adjustments.payment_type_ids[]` | `payment_types.id[]` | `company_financial_adjustments.payment_model_ids[]` recebe `payment_models.id[]` (memória diz que ids já batem com payment_models) |

Pontos derivados que vão precisar atualizar:
- `NewPayment.tsx` linha 2673 (`loteId` ← `payment.payment_type_id` é usado como `item_type_id`) — passa a derivar via lookup payment_model→item_type (mesmo `code`).
- `usePaymentTypeMeta` em `PaymentDetail.tsx` (236) e `CompanyAnalysis.tsx` (267, 2441, 2450) — refatorar para aceitar `payment_model_id` e resolver o meta via JOIN.
- `cross-reference-parecer/index.ts` (94, 98) — passar a ler `mixed_parecer_item_type_id`.
- `ZeevRetroactiveGapsCard.tsx` (já tem dual-read; remover fallback ao concluir).

#### D3.e.3 — Migration DB (add → backfill → swap)

1. Adicionar colunas novas:
   - `companies.default_item_type_id uuid REFERENCES item_types(id)`
   - `payments.mixed_parecer_item_type_id uuid REFERENCES item_types(id)`
   - `company_financial_adjustments.payment_model_ids uuid[]`
2. Backfill via JOIN por `code`:
   - `default_item_type_id ← item_types.id WHERE item_types.code = payment_types.code AND payment_types.id = default_payment_type_id`
   - `mixed_parecer_item_type_id` análogo
   - `payment_model_ids ← array de payment_models.id mapeados a partir de payment_type_ids`
3. Triggers bidirecionais temporários (espelho legacy ↔ novo) para o intervalo D3.e.2 → D3.e.4.
4. (D3.a complementar) Validar que `payments.payment_model_id` está 100% populado e sem divergência via `v_legacy_payment_type_divergence`.

#### D3.e.4 — Drop final
Após 1 ciclo de produção sem inserts/updates em colunas legadas (auditável via `pg_stat_user_columns` ou trigger de logging temporário):

- `DROP TRIGGER trg_sync_payments_type_columns` + função `sync_payments_type_columns`
- `ALTER TABLE payments DROP COLUMN payment_type_id`
- `ALTER TABLE payments DROP COLUMN mixed_parecer_payment_type_id`
- `ALTER TABLE companies DROP COLUMN default_payment_type_id`
- `ALTER TABLE company_financial_adjustments DROP COLUMN payment_type_ids`
- Drop final da view `v_legacy_payment_type_divergence` (sem alvos).
- Avaliar drop da própria tabela `payment_types` (se não houver mais nenhum consumidor — provavelmente vira deprecated junto).

---

### Ações pendentes herdadas (não esquecer)

Estas ficaram em "no-op" nas ondas anteriores e voltam aqui:

1. **De D3.a** — refatorar 7 pontos em `NewPayment.tsx`, `NewManualPayment.tsx`, `NewManualPaymentComposicao.tsx`, `ManualPaymentEntry.tsx`, `CompanyAnalysis.tsx`, `PaymentDetail.tsx`, `ZeevRetroactiveGapsCard.tsx` para usar `payment_model_id`.
2. **De D3.d** — refatorar `ItemsDataGrid` (default da empresa), `MixedParecerSetupCard` + `MixedParecerRetroAction`, `CompanyFinancialAdjustmentsDialog` + `CreditosDebitos`, `cross-reference-parecer`.
3. Remover dual-reads e fallbacks `?? payment_type_id` que sobrarem após D3.e.2.
4. Atualizar a memória `payment-type-id-rename-hybrid.md` ao final, marcando todas as colunas como removidas e excluindo o arquivo se virar irrelevante.

---

### Riscos

- **Combo migration mistura tabelas:** se `payment_types` e `payment_models` têm `code` divergentes para algum registro, backfill deixa NULL — precisa relatório prévio antes da migration.
- **Subtipo parecer (`mixed_parecer_*`)** aponta para item_types específicos (`parecer`, `visita`) — confirmar que `item_types` tem todos os subtipos cadastrados.
- `company_financial_adjustments.payment_type_ids` é array — backfill exige `unnest` + `array_agg`. Comportamento atual do filtro em `apply-company-deductions` já assume "ids unificados com payment_models.id" (comentário do código), então o mapping deve ser direto.
- Triggers bidirecionais durante a transição: cuidado com loops — usar guarda `WHEN OLD IS DISTINCT FROM NEW` ou flag de origem.

---

### Ordem sugerida de execução

1. Relatório prévio: listar `payment_types` sem equivalente em `item_types`/`payment_models` por `code` (bloqueio pré-migration).
2. D3.e.3 (add colunas + backfill + triggers de espelho).
3. D3.e.1 (hooks/helpers).
4. D3.e.2 por consumidor — começar pelos de menor impacto (`CompanyFinancialAdjustmentsDialog`, `MixedParecerSetupCard`) antes de tocar `NewPayment`.
5. Janela de observação (≥ 1 ciclo de uso real).
6. D3.e.4 (drop final).

---

### Estimativa

- 1 migration de adição + backfill + triggers.
- ~10 arquivos frontend tocados.
- 2 edge functions ajustadas.
- 1 migration final de drop.
- Janela de observação: o tempo que o usuário definir.
