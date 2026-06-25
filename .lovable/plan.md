
# Pool é soberano: itens sem dono + tela unificada

Objetivo: transformar a regra "pool é soberano" em modelo de dados + UI, sem deixar `company_id` enganoso e sem manter a tela por-PJ no contexto errado.

## 1. Modelo de dados

- Tornar `payment_items.company_id` **opcional** quando o lote for pool. O item passa a viver no pool, não numa PJ.
- Adicionar coluna `is_pool_item boolean` em `payment_items` (default `false`). Trigger garante:
  - Se `payment.pool_id IS NOT NULL` → `is_pool_item = true` e `company_id` pode ser NULL.
  - Se `payment.pool_id IS NULL` → `is_pool_item = false` e `company_id` é obrigatório (regra atual).
- Atualizar RLS: leitura/escrita de itens de pool segue o escopo do `payment` (hospital_id), não da PJ.
- Reverter a função `distribute_unmatched_items_by_doctor` no caminho pool: em vez de hashear médico em PJ, ela só **promove** os itens da quarentena para `payment_items` com `company_id = NULL` e `is_pool_item = true`.

## 2. Cálculo financeiro (sem mudança de regra, só de leitura)

- `payment_company_financials` continua tendo uma linha por PJ participante (bruto, descontos, líquido, % de participação, método). Já é o que alimenta o pool calc.
- Views que hoje fazem `JOIN payment_items USING (company_id)` para somar bruto por PJ passam a, em lote de pool, usar a **agregação do pool** (rateio dos `payment_company_financials`), não a soma direta dos itens.

## 3. Roteamento

- Quando o usuário acessar `/pagamentos/:id/empresa/:companyId` e o pagamento tiver `pool_id`, redirecionar para `/pagamentos/:id` (pool-mode).
- A tela `/pagamentos/:id` detecta `pool_id` e renderiza **PoolModeView** no lugar do split por-empresa.

## 4. Tela pool-mode (`PoolModeView`)

Layout único, sem filtro/coluna de empresa.

```
┌──────────────────────────────────────────────────────────┐
│ Header do lote (igual hoje)                              │
├──────────────────────────────────────────────────────────┤
│ Cards por PJ (1 por participante do pool)                │
│ ┌──────────────┐ ┌──────────────┐                        │
│ │ 2M CARDIO    │ │ MORAIS       │   … N cards            │
│ │ Bruto R$X    │ │ Bruto R$Y    │                        │
│ │ Descontos R$ │ │ Descontos R$ │                        │
│ │ Líquido R$   │ │ Líquido R$   │                        │
│ │ Participação │ │ Participação │                        │
│ │ Método: …    │ │ Método: …    │                        │
│ └──────────────┘ └──────────────┘                        │
├──────────────────────────────────────────────────────────┤
│ Auditoria do rateio (telemetria do pool calc)            │
├──────────────────────────────────────────────────────────┤
│ Itens em quarentena (igual hoje, mas botão diz           │
│   "Promover ao pool" em vez de "Distribuir entre PJs")   │
├──────────────────────────────────────────────────────────┤
│ Lista única de atendimentos (sem coluna Empresa)         │
│ Filtros: status, convênio, médico, tipo, parecer         │
└──────────────────────────────────────────────────────────┘
```

- Cruzamentos (NF, parecer, glosa) ficam no escopo do pool inteiro.
- Reconciliação Exacta: agrupa itens do pool e bate contra a base hospitalar sem desmembrar por PJ.
- Aprovação/finalização: uma decisão por pool (não uma por PJ).

## 5. Telas adjacentes

- BI / DRE / Pagamentos hub: linha do pagamento mostra "Pool: <nome>" com chips das PJs em vez de uma única PJ.
- Notificações ao diretor: usam o pool inteiro (já é a lógica). Sem mudança.

## 6. Migração de dados existentes

- Backfill: para todos os `payment_items` cujo `payment.pool_id IS NOT NULL` e `company_id` corresponde a participante do pool → setar `is_pool_item = true`. Mantém `company_id` por enquanto (não força NULL retroativo) para não quebrar histórico, mas a UI lê pelo `is_pool_item` e ignora o `company_id`.
- Itens que acabei de distribuir round-robin agora (lote 07d999fc) ficam marcados como pool e a UI une tudo de novo.

## 7. Memória

Atualizar `mem://features/pool-soberano.md` com o modelo final (itens sem dono, tela única, cards por PJ).

## Detalhes técnicos

- Migration:
  - `ALTER TABLE payment_items ADD COLUMN is_pool_item boolean NOT NULL DEFAULT false;`
  - `ALTER TABLE payment_items ALTER COLUMN company_id DROP NOT NULL;` (se hoje é NOT NULL)
  - Trigger `enforce_pool_item_consistency` BEFORE INSERT/UPDATE.
  - Backfill conforme item 6.
  - Reescrever `distribute_unmatched_items_by_doctor` no ramo pool.
- Front:
  - Novo componente `src/pages/PaymentDetailPool.tsx` (ou branch dentro do `PaymentDetail` atual).
  - `PaymentCompanyCards.tsx` lê `payment_company_financials` por `payment_id`.
  - Lista de itens reusa o grid atual com prop `hideCompanyColumn`.
  - Guard de rota: `/empresa/:id` faz `<Navigate to={`/pagamentos/${id}`} />` quando `pool_id`.
- Testes:
  - Trigger: insert com pool sem company_id passa; insert sem pool sem company_id falha.
  - Função distribute: pool → todos itens com company_id NULL + is_pool_item true.
  - Rota: acesso a `/empresa/:id` em pool redireciona.
