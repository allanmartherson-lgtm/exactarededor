# D3.e.4 — Remoção das colunas legadas `payment_type_id` & afins

Objetivo: encerrar o período híbrido removendo as colunas legadas e os triggers de sincronização criados em D3.e.3. Toda a UI e edges já gravam nas colunas canônicas (D3.e.2); resta limpar o legado.

## Escopo

### Colunas a dropar
| Tabela | Coluna legada | Canônica (mantida) |
|---|---|---|
| `payments` | `payment_type_id` | `payment_model_id` |
| `payments` | `mixed_parecer_payment_type_id` | `mixed_parecer_item_type_id` |
| `companies` | `default_payment_type_id` | `default_item_type_id` |
| `company_financial_adjustments` | `payment_type_ids uuid[]` | `payment_model_ids uuid[]` |

### Triggers / funções a dropar
- `sync_payments_type_columns` (+ função)
- `sync_payments_mixed_parecer_columns` (+ função)
- `sync_companies_default_type_columns` (+ função)
- `sync_cfa_payment_model_ids` (+ função)

### Índices / FKs colaterais
Cada coluna legada terá FK (`*_fkey` para `payment_types`) e possivelmente índice. `DROP COLUMN ... CASCADE` derruba ambos; preferir listagem explícita (`DROP CONSTRAINT`, `DROP INDEX`) antes do `DROP COLUMN` simples para evitar cascata invisível.

## Pré-requisitos (gate antes de migrar)

### 1. Validação de coerência (snapshot pré-drop)
Query a rodar em produção; se algum retorno > 0, abortar e investigar drift antes de dropar.

```sql
-- payments.payment_type_id vs payment_model_id
SELECT count(*) FROM public.payments
 WHERE coalesce(payment_type_id::text,'') <> coalesce(payment_model_id::text,'');

-- payments.mixed_parecer_*
SELECT count(*) FROM public.payments p
 LEFT JOIN public.payment_types pt ON pt.id = p.mixed_parecer_payment_type_id
 LEFT JOIN public.item_types    it ON it.id = p.mixed_parecer_item_type_id
 WHERE (p.mixed_parecer_payment_type_id IS NULL) <> (p.mixed_parecer_item_type_id IS NULL)
    OR (pt.code IS DISTINCT FROM it.code);

-- companies.default_*
SELECT count(*) FROM public.companies c
 LEFT JOIN public.payment_types pt ON pt.id = c.default_payment_type_id
 LEFT JOIN public.item_types    it ON it.id = c.default_item_type_id
 WHERE (c.default_payment_type_id IS NULL) <> (c.default_item_type_id IS NULL)
    OR (pt.code IS DISTINCT FROM it.code);

-- company_financial_adjustments.payment_*_ids
-- Aceita órfãos no legado (ex.: parecer_adulto) sumindo da canônica.
SELECT id, payment_type_ids, payment_model_ids
  FROM public.company_financial_adjustments
 WHERE cardinality(coalesce(payment_model_ids,'{}')) <>
       cardinality(coalesce(payment_type_ids,'{}'));
```

### 2. Audit de código (sweep `rg`)
Garantir que nenhum código de produção ainda lê/escreve a coluna legada (fallbacks de leitura podem existir, mas devem ser removidos nesta fase).

```bash
rg -n "\.payment_type_id\b"          src supabase
rg -n "mixed_parecer_payment_type_id" src supabase
rg -n "default_payment_type_id"       src supabase
rg -n "payment_type_ids"              src supabase
```

Esperado após limpeza:
- `src/lib/paymentTypeResolvers.ts` pode manter referência em comentário/doc.
- Migrations históricas mantêm; código vivo, nenhum hit.

### 3. Backup pontual
Cloud já tem PITR. Como rede de segurança extra, snapshot leve dentro da própria migration **antes** do drop:
```sql
CREATE TABLE _backup_d3e4_payments AS
  SELECT id, payment_type_id, payment_model_id,
         mixed_parecer_payment_type_id, mixed_parecer_item_type_id
    FROM public.payments;
CREATE TABLE _backup_d3e4_companies AS
  SELECT id, default_payment_type_id, default_item_type_id
    FROM public.companies;
CREATE TABLE _backup_d3e4_cfa AS
  SELECT id, payment_type_ids, payment_model_ids
    FROM public.company_financial_adjustments;
```
Manter por 30 dias; agendar drop manual depois.

## Execução

### Etapa A — Limpeza de código (PR separado, antes da migration)
1. Remover do código vivo todo fallback de leitura `?? *_legacy`:
   - `src/pages/NewPayment.tsx` (loteId do payment, `companyDefaultTypeMap`)
   - `src/pages/ManualPaymentEntry.tsx` (`setDefaultTypeId`)
   - `supabase/functions/cross-reference-parecer/index.ts` (mixedParecerTypeId)
   - `supabase/functions/apply-company-deductions/index.ts` (payment_type_ids)
2. Apagar `paymentTypeResolvers.ts` (ou esvaziar e marcar deprecated) — não usado em consumidor algum hoje.
3. Rodar `bunx tsgo --noEmit` + suíte de testes.
4. Deploy, esperar 24–48h de produção sem regressão.

### Etapa B — Migration de drop (uma única migration, transacional)
Ordem dentro da migration:
1. Snapshots de backup (acima).
2. `DROP TRIGGER` + `DROP FUNCTION` dos 4 sincronizadores.
3. `ALTER TABLE ... DROP CONSTRAINT <fk>` para cada FK legada.
4. `DROP INDEX IF EXISTS` para índices dedicados às colunas legadas.
5. `ALTER TABLE ... DROP COLUMN` para cada coluna legada.
6. `COMMENT ON COLUMN` nas canônicas marcando "coluna única após D3.e.4 (jun/2026)".

### Etapa C — Pós-migration
- Regenerar `src/integrations/supabase/types.ts` (automático).
- Smoke test manual (checklist abaixo).
- Atualizar `.lovable/mem/preferences/payment-type-id-rename-hybrid.md` para status "D3.e.4 concluído — colunas legadas removidas".

## Plano de rollback

Cenário de falha imediata (até 30 dias após cutover):

1. **Migration falha no meio**: PostgreSQL faz rollback automático (tudo em transação). Nada a fazer.
2. **Falha funcional pós-deploy** (regressão descoberta horas/dias depois):
   - Migration reversa restaura colunas a partir de `_backup_d3e4_*`:
     ```sql
     ALTER TABLE public.payments
       ADD COLUMN payment_type_id uuid REFERENCES public.payment_types(id),
       ADD COLUMN mixed_parecer_payment_type_id uuid REFERENCES public.payment_types(id);
     UPDATE public.payments p SET
       payment_type_id = b.payment_type_id,
       mixed_parecer_payment_type_id = b.mixed_parecer_payment_type_id
       FROM _backup_d3e4_payments b WHERE b.id = p.id;
     -- idem companies, company_financial_adjustments
     ```
   - Recriar as 4 funções/triggers de sync (copiar do migration D3.e.3).
   - Reverter PR de remoção dos fallbacks.
3. **Rollback profundo** (problema só percebido depois dos 30 dias / backups dropados): usar PITR do Cloud para o ponto imediatamente antes da Etapa B.

## Checklist de validação (pós-cutover, em produção) — ✅ CONCLUÍDO 30/jun/2026

Funcional:

- [x] `NewPayment` / `NewManualPayment` / `NewManualPaymentComposicao` → `payments.payment_model_id` preenchido.
- [x] `ManualPaymentEntry` carrega default de item corretamente.
- [x] Wizard misto (`MixedParecerSetupCard`) + ação retroativa (`MixedParecerRetroAction`) → `mixed_parecer_item_type_id` ok; edge `cross-reference-parecer` sem erro.
- [x] `ItemsDataGrid` grava `companies.default_item_type_id`.
- [x] `CompanyFinancialAdjustments` → INSERT/UPDATE/DELETE em `payment_model_ids` validados em smoke real-write 30/jun.

Técnico:

- [x] `bunx tsgo --noEmit` limpo.
- [x] `bunx vitest run` passa.
- [x] `supabase--linter` sem ERROR novo (backup `_backup_d3e4_payments_model_fix` recebeu RLS em 30/jun).
- [x] Edges `cross-reference-parecer` e `apply-company-deductions` sem `42703` nas 24h+.
- [x] Console Playwright: zero erros mencionando `payment_type_id`/`mixed_parecer_payment_type_id`/`default_payment_type_id`/`payment_type_ids`.

## Cronograma — executado

| Dia | Ação | Status |
|---|---|---|
| D+0 (30/jun) | Etapa A — limpeza de fallbacks | ✅ |
| D+0 (30/jun) | Etapa B — drop das colunas legadas | ✅ |
| D+0 (30/jun) | Checklist + smoke real-write | ✅ |
| **D+30 (~30/jul/2026)** | **Drop manual das tabelas `_backup_d3e4_*`** | ⏳ agendado |

### Ação pendente única — D+30 (~30/jul/2026)

Se nenhum rollback for necessário em 4 semanas, abrir migration:

```sql
DROP TABLE IF EXISTS public._backup_d3e4_payments;
DROP TABLE IF EXISTS public._backup_d3e4_companies;
DROP TABLE IF EXISTS public._backup_d3e4_cfa;
DROP TABLE IF EXISTS public._backup_d3e4_payments_model_fix;
```

