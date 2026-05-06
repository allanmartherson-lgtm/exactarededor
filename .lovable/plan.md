## Objetivo

Permitir alterar o lote enquanto está com o analista (status "em análise pela IA", "revisão analista" ou "devolvido analista"). Depois que vai para validação/aprovação, fica bloqueado. E garantir que quem cria o lote não pode validar nem aprovar.

## Regras (resumo)

**Status "editáveis pelo analista"** (chamamos `analystEditableStatuses`):
- `em_analise_ia`, `revisao_analista`, `devolvido_analista`, `rascunho`

**Quem pode editar nesse estado:** o analista criador do lote (e admin/diretor para correções administrativas).

**Segregação de funções:** validador/diretor que também é o `created_by` do lote NÃO pode validar nem aprovar este lote (mesmo tendo o papel). Mostra aviso no rodapé explicando.

## Mudanças

### 1. `src/lib/paymentFlow.ts`
Exportar conjunto `ANALYST_EDITABLE_STATUSES` e helper `canEditBatch(role, status, isOwner)` — single source of truth.

### 2. `src/pages/PaymentDetail.tsx` (header / metadados do lote)
- Habilitar edição inline dos campos do lote: `reference`, `description`, `competence_months`, `payment_type`, `payment_due_date`, `cost_center_code` quando `canEditBatch(...)` for true.
- Botão "Reimportar base" (substitui itens) visível só nesses status — abre o `ImportWizard` reaproveitando o `payment_id`.
- Esconder/bloquear "Validar" para o usuário se ele for o `created_by` (mesmo sendo validador).
- Esconder/bloquear "Aprovar" para o usuário se ele for o `created_by` (mesmo sendo diretor).
- Mostrar banner de aviso: "Você criou este lote — outro validador/diretor precisa concluir."

### 3. `src/pages/CompanyAnalysis.tsx` (tela atual do print)
- Adicionar botão "Editar empresa do grupo" (abre dialog com `CompanyCombobox`) quando editável — corrige match de empresa de TODOS os itens do grupo de uma vez.
- Linhas do `ItemsDataGrid` ganham menu "…" com:
  - Editar item (valor bruto, especialidade, médico, empresa, centro de custo)
  - Excluir item
  Disponíveis apenas se `canEditBatch` for true.
- Após qualquer edição: recomputar `total_amount`/`items_count` do grupo e disparar reanálise da IA automaticamente para os itens afetados.
- Bloquear "Enviar para validação" se grupo está vazio depois de exclusões.

### 4. RLS / banco
Os policies atuais já permitem update por `analista`/`admin`/`diretor` sem checar status. Para travar de verdade no servidor:
- Migration: ajustar policy `payments_update_workflow` e `items_manage_workflow` para exigir
  `status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista')` quando o ator for analista. Admin/diretor mantêm update irrestrito (já podem corrigir).
- Migration: policy nova que impede `validated_by = created_by` e `approved_by = created_by` (CHECK via trigger BEFORE UPDATE em `payment_company_groups` e `payments`).

### 5. UI auxiliar
- Em todas as tabelas/listas (Payments.tsx) onde já aparece "Validar"/"Aprovar", desabilitar a ação quando `row.created_by === user.id` com tooltip "Você criou este lote".

## Não muda
- Fluxo de status / transições (`paymentFlow.ts` TRANSITIONS) permanece igual.
- Validador/diretor seguem podendo devolver para o analista — quando volta, o lote fica editável de novo automaticamente (já está em `devolvido_analista`).

## Detalhes técnicos

- Reanálise automática ao editar item: chamar a edge function `analyze-payment` com flag `only_item_ids` (já existe ou adicionar parâmetro).
- Edição de empresa do grupo: `UPDATE payment_items SET company_id, company_name WHERE id IN (...)` + recriar/atualizar `payment_company_groups` (mover itens entre grupos se a empresa nova já existir como grupo, ou criar grupo novo).
- Aprendizado de alias: igual ao já implementado em `NewPayment.tsx` — quando trocar empresa, append no `companies.aliases` da nova empresa o nome antigo.

Confirmar plano antes de implementar?