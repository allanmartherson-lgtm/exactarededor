## Bug do validador — RESOLVIDO

**Causa raiz:** a edge `analyze-payment` sempre forçava `payments.status` e `payment_company_groups.status` de volta para `revisao_analista`, mesmo quando o lote já tinha sido enviado para validação. Quando a reanálise rodava em background (ex.: após o analista clicar "Enviar para validação"), o lote era "roubado" da fila do validador segundos depois.

**Fix aplicado (já deployado):** a edge agora só rebaixa o status para `revisao_analista` se o pagamento/grupo ainda estiver em estado pertencente ao analista (`rascunho`, `em_analise_ia`, `revisao_analista`, `devolvido_analista`). Se já estiver com validador/diretor, apenas atualiza o `ai_summary` e os achados — não mexe no status.

Isso resolve o caso do `Pagamento Teste 2`. Para reabrir manualmente os 4 lotes que ficaram presos em `revisao_analista` por causa do bug, posso aplicar uma correção de dados em seguida (basta o ok).

---

## Feature: roteamento de validador no envio

### Modelo de dados
- Nova tabela **`validator_groups`** (id, name, description, active, created_by/at, updated_at)
- Nova tabela **`validator_group_members`** (group_id, user_id) — many-to-many com `profiles`
- Em **`payment_company_groups`**, adicionar:
  - `assigned_validator_id uuid` (validador específico, opcional)
  - `assigned_validator_group_id uuid` (grupo de validadores, opcional)
  - exclusivos entre si; ambos nulos = fila geral (default)

Mesma estrutura para futura expansão de aprovadores fica preparada (mas sem implementar agora — escolha do usuário).

### Regras de visibilidade (RLS)
A política `pcg_view_workflow` continua liberando para qualquer validador ver, mas a UI filtra a fila por:
- assigned_validator_id = meu user_id, OU
- assigned_validator_group_id ∈ (grupos onde sou membro), OU
- ambos nulos (fila geral)

Admin/diretor continuam vendo tudo. RLS reforça que só o destinatário/grupo pode mudar status (`update` extra check).

### UI
1. **Tela "Configurações → Grupos de validadores"** (admin/diretor): CRUD simples — nome, descrição, escolher membros entre os usuários com role `validador`.
2. **Modal "Enviar para validação"** (analista, em `PaymentDetail`): hoje envia direto. Passa a abrir um pequeno popover com 3 opções:
   - Fila geral (default — comportamento atual)
   - Validador específico (combobox de usuários `validador`)
   - Grupo de validadores (combobox de grupos ativos)
   - Aplica a escolha por empresa (ou para todas as empresas do lote, com toggle "aplicar a todas").
3. **Páginas `Payments.tsx` e `Dashboard.tsx`**: filtro da fila de validador inclui `assigned_validator_id = me OR group ∈ meus OR ambos nulos`. Mostra um chip discreto "Atribuído a você" / "Grupo X" quando aplicável.

### Edge functions
- Nenhuma mudança lógica; só passar os campos novos no insert/update do grupo.

### Retrocompatibilidade
- Pagamentos antigos: `assigned_*` ficam nulos → fila geral (não muda nada).
- Default no envio: fila geral (conforme escolhido).

### Aprovadores
Fora desse escopo (só validador agora), mas a modelagem já fica genérica o suficiente para reuso.

---

### Ordem de execução
1. Migração (tabelas + colunas + RLS).
2. Tela de gestão de grupos.
3. Modal de envio com escolha.
4. Filtros de fila no Dashboard / Payments.
5. Indicador visual nos cards.