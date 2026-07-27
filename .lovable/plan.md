
# Escopo — só o solicitado, sem melhorias adjacentes

## 1. PJs sem checkbox habilitado e sem motivo visível
**Arquivo:** `src/components/retroactive/RetroactiveReconciliationsTab.tsx`
- Investigar por que `isActionableTvr(r)` retorna false para itens de C M FRANCA / CAIM / CIRURGIA BRASILIA (ler helper e ver bucket real desses itens).
- Quando um item for não-acionável, renderizar o checkbox **desabilitado** já hoje faz isso, mas **acrescentar tooltip/badge com o motivo** ("Já encaminhado", "Sem PJ vinculada", "Sem cálculo", etc.) na coluna Ações — hoje aparece vazio.
- Motivo deriva de `bucket`/`status`/flags existentes (sem novas colunas).

## 2. Itens já encaminhados não são sinalizados
**Arquivo:** `src/components/retroactive/RetroactiveReconciliationsTab.tsx`
- Marcar visualmente (badge "Já encaminhado" + linha atenuada) os itens cujo `retroactive_forward_status`/`payment_item_id` já esteja vinculado a um lote de glosa (campo já persistido; hoje só bloqueia no submit).
- Excluí-los da contagem "Selecionar todos" e do batch de encaminhamento antes de disparar o modal (evita o alerta de erro reativo).

## 3. Encaminhamento marca "confecção de lote" por padrão
**Arquivo:** modal de revisão do encaminhamento (dentro de `RetroactiveReconciliationsTab.tsx` ou componente filho — confirmar ao editar).
- Trocar default `criarLoteConfeccao = true` → `false`.
- Ajustar texto/agrupamento: seção 1 "Encaminhar glosas" (default), seção 2 "Também criar lote de confecção para itens a pagar" (opt-in, com explicação curta).
- Não mexer na lógica de criação — só no default e no rótulo.

## 4. Barra sticky cobre a última empresa
**Arquivo:** `src/components/retroactive/RetroactiveReconciliationsTab.tsx`
- Adicionar `padding-bottom` dinâmico no container da lista (~96px) quando `selectedKeys.size > 0`, para o conteúdo poder rolar por cima da barra.

## 5. Sugestão de parcelamento por médico ao encaminhar
**Arquivo:** modal de encaminhamento (mesmo componente / helper).
- Remover UI e payload de "parcelas por médico" no fluxo de encaminhar glosa. Encaminhamento envia valor integral; parcelamento fica só na tela Créditos e Débitos.
- Verificar se a Edge Function que recebe o payload aceita ausência do campo (se exigir, enviar `parcelas: 1` fixo, sem UI).

## 6. Vínculo médico → PJ desatualizado exige reprocesso
**Arquivos:**
- `src/components/retroactive/RetroactiveReconciliationsTab.tsx`
- possivelmente novo componente `DoctorCompanyReassignDialog.tsx` (pequeno, isolado)

Comportamento:
- Botão "Reavaliar vínculos" no header da lista → lê `doctor_companies` ativo e, para cada item cuja PJ atual difere do vínculo ativo, marca conflito.
- Quando há mais de uma PJ possível (duplo vínculo / migração), abrir dialog para o analista escolher **por médico** em qual PJ lançar (opções: PJ do lote original / PJ ativa atual / lista das PJs vinculadas).
- Atualiza `company_id`/`retroactive_target_company_id` dos itens selecionados sem re-rodar motor.
- Preserva histórico (não apaga original — grava override).

**Banco:** verificar se já existe coluna de override (`retroactive_target_company_id`). Se não existir, avisar antes e propor migration mínima.

## 7. Filtros por coluna na tela de Pagamentos
**Arquivo:** `src/pages/Payments.tsx`
- Adicionar dropdown de filtro no header da coluna **Status** (multi-select dos status existentes).
- Reaproveitar filtro atual (não duplicar): o dropdown escreve no mesmo state que os chips já usam.
- Sem tocar nas outras colunas nesta rodada.

---

## Ordem sugerida de execução
1, 2, 4 (mesmo arquivo, rápido) → 3, 5 (modal de encaminhamento) → 7 (Payments) → 6 (mais complexo, pode precisar de migration).

## Confirmar antes de começar
- **Item 6:** posso adicionar coluna `retroactive_target_company_id` em `retroactive_reconciliations` (ou tabela equivalente) se ainda não existir? É a única mudança de schema prevista.
- **Item 3:** confirmo que o default deve ser "só glosa" mesmo quando há itens a pagar no encaminhamento?

Nenhum outro arquivo será tocado além dos listados. Aguardando aprovação.
