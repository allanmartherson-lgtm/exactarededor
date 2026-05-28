# Solução completa de performance — Pagamentos

Objetivo: deixar a listagem de Pagamentos rápida e estável mesmo com 10k+ lotes, mantendo a fila de prioridade correta e todos os filtros atuais funcionando em toda a base (não só na página visível).

## Entregas

### 1. Banco — `priority_score` persistido
- Adicionar coluna `priority_score numeric` em `payments` + índice `idx_payments_priority (priority_score DESC, created_at DESC)`.
- Função `public.calculate_payment_priority(payment_id)` que reproduz a lógica hoje feita no cliente (SLA + severidade + valor + dias parado + nº de alertas + perguntas abertas).
- Triggers que recalculam quando muda:
  - `payments.status`, `payments.total_amount`, `payments.updated_at`
  - inserção/atualização em `payment_observations` (perguntas abertas)
  - mudança em `payment_company_groups.status`
- Cron diário (`pg_cron`) para recalcular o componente "dias parado" de todos os lotes ativos uma vez por dia.
- Backfill inicial de todos os lotes existentes.

### 2. Banco — view materializada de flags
- `mv_payments_flags` com colunas booleanas pré-calculadas: `is_overdue`, `has_open_question`, `has_divergence`, `has_glosa_pendente`.
- Refresh a cada 5 min via `pg_cron` (tolerância OK para esses filtros).
- Índice por `payment_id`.

### 3. Banco — RPC de listagem paginada
- `public.list_payments(filters jsonb, p_limit int, p_offset int, p_sort text)` retornando `{ rows: jsonb, total: bigint }`.
- Filtros suportados server-side: `status[]`, `company_ids[]`, `doctor_ids[]`, `competence_from/to`, `search` (via `pg_trgm` em nº do lote, médico, empresa), `only_overdue`, `only_open_questions`, `only_divergence`, `assigned_to`.
- Ordenação: `priority_score DESC` (default) ou `created_at`, `competence`, `total_amount`.
- Faz JOIN com `mv_payments_flags` e aplica `LIMIT/OFFSET` no banco.
- Índices `pg_trgm` em `payments.batch_number`, `companies.name`, `doctors.full_name` para busca textual rápida.

### 4. Frontend — `Payments.tsx`
- Substituir o fetch atual (que baixa tudo) por chamada à RPC com `{ filters, limit: 50, offset: page*50, sort }`.
- Hook `usePaymentsPaginated(filters, page, sort)` com React Query.
- Componente de paginação: "← Anterior | Página X de Y | Próximo →" + seletor "50/100/200 por página".
- Todos os filtros atuais (status, empresa, médico, competência, atrasados, perguntas abertas, divergência, busca) passam a enviar para a RPC; o array em memória vira apenas a página corrente.
- Remover o cálculo client-side de `priority_score` — usar o valor que vem da RPC.
- Manter realtime atual (com debounce 600ms) só para invalidar a query da página visível.

### 5. Limpeza
- Remover o hook/util que calculava priority no cliente (substituído pelo SQL).
- Remover loops que iteravam todo o array para badges agregados — passar a usar os contadores que a RPC já retorna em `total` por filtro.

## Detalhes técnicos

```text
Fluxo:
  UI (filtros + page) ──► RPC list_payments ──► payments JOIN mv_flags
                                              ORDER BY priority_score DESC
                                              LIMIT 50 OFFSET N
                                       ◄── { rows: [...], total: 832 }
```

```text
Triggers de priority_score:
  payments      AFTER UPDATE OF status, total_amount        ─► recalc(payment_id)
  payment_observations  AFTER INSERT/UPDATE/DELETE          ─► recalc(payment_id)
  payment_company_groups AFTER UPDATE OF status             ─► recalc(payment_id)
  pg_cron diário 03:00                                       ─► recalc all active
```

Fórmula do `priority_score` (replica a do cliente):
- base = severidade do status (0–40)
- + idade em dias até teto de 30 (0–20)
- + log(total_amount+1) normalizado (0–15)
- + nº alertas críticos × 3 (0–15)
- + perguntas abertas × 2 (0–10)
- clamp 0–100

## Impacto esperado
- Carregamento inicial: ~3–5s → ~200–400ms (independe do tamanho da base).
- Memória do navegador: cai ~80% em bases grandes.
- Filtros e busca: passam a refletir a base inteira, não a página.
- Ordenação por prioridade: correta globalmente, não só na página atual.

## Plano de execução
1. Migração: coluna + função + triggers + índices + mv + RPC + backfill (1 migração consolidada).
2. Cron jobs (refresh mv + recálculo diário) via insert tool.
3. Frontend: novo hook + paginação + remoção do cálculo client-side.
4. QA: validar contagens, ordenação e filtros contra a versão antiga.

Estimativa: ~3–4 dias de trabalho efetivo, entregue em sequência única. Confirma para eu começar pela migração?
