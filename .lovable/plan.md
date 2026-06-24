## Escopo

Dois recursos novos no módulo de Pools, entregues juntos:
1. **Deduções variáveis por competência** (caso "plantão fim de semana").
2. **Pool com escopo filtrado** (captura visitas de qualquer médico → rateia para PJs do pool).

Mais auditoria reforçada e bloqueio de duplicidade.

---

## 1. Banco (migration única)

### `pool_deductions` — colunas novas
- `valor_variavel boolean default false` — quando true, `valor` não é usado; o motor busca em `pool_deduction_values`.

### Nova tabela `pool_deduction_values`
- `pool_deduction_id` (FK), `competence_month` (date, dia 01), `valor numeric`, `observacao text`, `created_by`, `created_at`, `updated_at`.
- `unique(pool_deduction_id, competence_month)`.
- GRANT + RLS por hospital (via pool→hospital_id).

### `pools` — colunas novas
- `escopo_producao text default 'participantes' check in ('participantes','filtrado')`.
- `filtros_captura jsonb default '{}'` — `{tipo_ato_ids:[], setor_ids:[], convenio_ids:[], funcao_ids:[], doctor_include_ids:[], doctor_exclude_ids:[]}`.

### `pool_calculation_runs` — colunas novas
- `captured_item_ids uuid[]` — auditoria dos itens que entraram na base (escopo filtrado).
- `invalidated_at timestamptz`, `invalidated_reason text` — para edição pós-cálculo.

### Nova tabela `pool_item_claims` (bloqueio de duplicidade)
- `payment_item_id`, `pool_id`, `competence_month`, `run_id`.
- `unique(payment_item_id, competence_month)` — garante que o mesmo item não cai em 2 pools na mesma competência.

### Trigger
- Ao `UPDATE/INSERT` em `pool_deduction_values`, marcar `invalidated_at=now()` no último run do pool dessa competência (se existir) + escrever em `audit_log`.

---

## 2. Motor (edge function `calculate-pool` — atualizar)

Para cada pool sendo calculado em uma competência:

1. **Resolver base**:
   - `escopo_producao='participantes'` → comportamento atual.
   - `escopo_producao='filtrado'` → `SELECT payment_items WHERE competence=X AND <filtros_captura>`. Médico real e empresa real são preservados nos `captured_item_ids`, mas não entram no split.

2. **Bloqueio de duplicidade**: antes de finalizar o run, tentar `INSERT` em `pool_item_claims`. Se conflito, abortar com `reason: 'item_duplicado_em_outro_pool'` listando os itens conflitantes.

3. **Resolver deduções**:
   - Fixas: usa `valor`.
   - Variáveis: busca `pool_deduction_values` por `(deduction_id, competence)`. Se faltar → **bloqueia run** com `reason: 'plantao_competencia_nao_cadastrado'` + qual dedução/mês.

4. **Snapshot**: gravar `captured_item_ids` + valores de cada dedução variável usada no `snapshot` jsonb do run.

5. **Médico não recebe** (escopo filtrado): marcar os itens capturados com `absorbed_by_pool_id` em `payment_items` (coluna nova) → frontend de pagamento mostra "Absorvido pelo pool X" e zera repasse do médico para esses itens.

---

## 3. UI

### `src/pages/Pools.tsx` (cadastro)

- **Bloco "Escopo de produção"** (radio):
  - "Produção das empresas participantes" (default)
  - "Captura por filtro" → revela bloco "Filtros de captura":
    - Multi-select: tipo de ato, setor, convênio, função, médicos incluídos, médicos excluídos.

- **Deduções**: toggle "Valor variável por competência" em cada linha de dedução.
  - Quando ligado: campo "Valor (R$)" some, aparece botão **"Gerenciar valores mensais →"** (abre nova rota).

### Nova rota `src/pages/PoolMonthlyValues.tsx` (`/pools/:id/valores-mensais`)
- Tabela: linhas = competências (últimas 12 + próximas 3), colunas = cada dedução variável do pool.
- Edição inline com `observacao`.
- Indicador "⚠ Invalida run X de YYYY-MM" quando o valor for alterado depois do cálculo.
- Histórico (audit_log) expandível por célula.

### `src/pages/PoolsReport.tsx` (relatório existente)
- Nova aba **"Itens capturados"** quando o run tem `captured_item_ids`: tabela com atendimento, médico real, empresa real, valor, motivo do filtro.
- Badge **"Invalidado — precisa recalcular"** quando `invalidated_at` preenchido.
- Coluna "Deduções variáveis" mostrando valor + observação usados naquele run.

### `src/components/payment-detail/...` (item absorvido)
- Quando `payment_items.absorbed_by_pool_id` preenchido: badge "Absorvido pelo pool ⟶" + link.

---

## 4. Auditoria

- Toda mudança em `pool_deduction_values` → `audit_log` (entity=`pool_deduction_value`, action=`upsert/delete`, old/new).
- Cada run grava em `snapshot`: filtros aplicados, contagem de itens capturados, deduções variáveis usadas (valor + observação + quem cadastrou).
- Conflitos de duplicidade ficam em `pool_calculation_runs.error_detail` com a lista de items + pools concorrentes.

---

## Ordem de entrega (1 turno)

1. Migration (schema + grants + RLS + trigger).
2. Tipos regenerados automaticamente.
3. Edge function `calculate-pool` atualizada.
4. UI: cadastro do pool + nova rota mensal + ajustes no relatório + badge no item absorvido.
5. Smoke test manual orientado.

Confirma para eu disparar a migration?