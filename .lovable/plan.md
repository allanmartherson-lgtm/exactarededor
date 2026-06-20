
## Contexto

Hoje o modo confecção compartilha a máquina de estados de análise (`aprovado`, `pendente`, `glosa`, etc.) e é read-only nas linhas. Precisamos:

1. Substituir o status visual em confecção por **3 estados objetivos** que dizem apenas se o motor conseguiu calcular.
2. Permitir que o analista **ajuste linhas** (valor convênio, médico, TUSS, função, setor), **exclua** (soft delete auditado) e **adicione** linhas manuais.
3. Não tocar no caso 40202542 — diagnóstico já entregue (faltava o código no `procedure_codes` da regra).

---

## Parte 1 — Status simplificado no modo confecção

### Estados (derivados, não persistidos como novo enum)
- **com regra** — `applied_rule_id IS NOT NULL` e `expected_amount` calculado (motor respondeu).
- **sem regra** — nenhuma regra casou (`sem_regra = true` ou `applied_rule_id IS NULL`).
- **divergente** — motor casou regra mas houve inconsistência (ex: pendência de cálculo, ambiguidade entre cálculos, código fora da lista esperada, alerta do limiar).

### Onde aplicar
- Coluna **Status** do grid de itens em `ItemsDataGrid` quando `analysis_mode === "confeccao"`.
- Banner / agregadores do header da empresa (contagens "aprovado/pendente" viram "com regra/sem regra/divergente").
- Filtro de status do topo do grid: trocar opções quando em confecção.

### Não muda
- Coluna `ai_status` no banco fica como está (vamos só esconder os labels antigos na UI de confecção). Ao **finalizar confecção** e entrar em análise, o status volta a ser o atual.

---

## Parte 2 — Edição operacional no modo confecção

Todas as ações abaixo só ficam ativas quando `analysis_mode === "confeccao"` E `confeccao_status` permite edição (ou seja, não está finalizado). Todas geram entrada em `audit_log` com `action`, `before`, `after`, `user_id`.

### 2.1 Editar valor convênio (`procedure_amount`)
- Célula editável no grid (já existe handler de edição inline para outras colunas em `ItemsDataGrid`).
- Validação: número >= 0, máx 2 decimais.
- Após salvar: dispara **recálculo da linha** (motor re-roda só aquele item via `analyze-payment` com escopo `item_ids`) para atualizar `expected_amount`.
- Snapshot financeiro da empresa marcado como stale → `useFinancialComposition` recarrega.

### 2.2 Editar médico / TUSS / função / setor
- Modal "Editar linha" (botão de lápis na linha) com 4 campos:
  - **Médico**: Combobox usando `registryLookup` (estrito — só matches válidos).
  - **TUSS**: input livre 8 dígitos + validação.
  - **Função** (`doctor_role`): select com valores canônicos (Cirurgião Principal, 1º Aux, 2º Aux, Anestesista, Instrumentador, Clínico…).
  - **Setor**: Combobox via `useSectorAliases`.
- Ao salvar: persiste, marca `manual_edit = true` (nova coluna boolean default false) e dispara recálculo da linha.

### 2.3 Excluir linha (soft delete)
- Botão lixeira → `confirm()` com motivo obrigatório (texto livre).
- Set `is_cancelled = true`, `cancellation_reason = motivo`, `cancelled_by = user_id`, `cancelled_at = now()`.
- Linha some dos agregados ativos (já é o comportamento de `is_cancelled` em `useFinancialComposition` modo confecção).
- Nunca DELETE físico — preserva auditoria e permite "reativar".

### 2.4 Adicionar linha manual
- Botão "+ Adicionar linha" no topo do grid.
- Modal com: Atendimento, Data, Paciente, TUSS, Médico, Função, Setor, Convênio, Valor convênio (`procedure_amount`).
- Insere `payment_items` com `analysis_mode='confeccao'`, `manual_entry=true`, `payment_company_group_id` = grupo atual.
- Dispara recálculo do item.

### Gate de segurança
- Edição bloqueada se grupo já está "finalizado confecção" (`confeccao_status='finalizado'`) — usuário precisa reabrir.
- RLS: só usuários com role analista/admin do hospital ativo.
- Toda mudança em `payment_items` no modo confecção entra em `audit_log` com `entity='payment_item'`, `entity_id`, `action ∈ {update_field, soft_delete, manual_insert, recalc}`.

---

## Schema

Migration única adicionando colunas de auditoria/origem:

```sql
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
```

(sem alteração de GRANT — `payment_items` já tem grants completos)

---

## Detalhes técnicos

- **Arquivos principais a editar:**
  - `src/components/payment-detail/ItemsDataGrid.tsx` — coluna Status condicional, edição inline `procedure_amount`, botões lixeira + lápis, "+ Adicionar".
  - `src/components/payment-detail/EditItemDialog.tsx` (novo) — modal de edição médico/TUSS/função/setor.
  - `src/components/payment-detail/AddItemDialog.tsx` (novo) — modal de inclusão manual.
  - `src/lib/itemConfeccaoStatus.ts` (novo) — função pura `deriveConfeccaoStatus(item) → 'com_regra' | 'sem_regra' | 'divergente'`.
  - `src/pages/CompanyAnalysis.tsx` — aplicar status derivado nos agregadores quando `isConfeccao`.
  - `src/lib/audit.ts` — helper `logItemChange()`.
  - Reuso de `analyze-payment` edge function com `item_ids: [id]` para recálculo unitário (já suporta).

- **Testes:**
  - `src/lib/__tests__/itemConfeccaoStatus.test.ts` — cobre 3 estados.
  - `src/components/payment-detail/__tests__/ItemsDataGrid.confeccao-edit.test.ts` — botões só aparecem em confecção editável, soft delete preserva linha no banco.
  - `src/pages/__tests__/CompanyAnalysis.confeccao-status.test.ts` — agregadores do header refletem novo conjunto.

- **Memória a atualizar:** `mem://features/confeccao-ui-separation` — adicionar regras de status simplificado + edição com auditoria.

---

## Fora de escopo

- Reabertura de confecção finalizada (fluxo separado).
- Importar correções em lote (CSV) — apenas edição manual unitária por enquanto.
- Editar `gross_amount` em confecção (não existe na fase).
