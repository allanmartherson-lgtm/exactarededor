# Motor Exacta — Pipeline único e gate de "leitura completa"

## Diagnóstico — por que ainda há falhas pontuais

O motor é executado por várias funções independentes, cada uma disparada por um gatilho diferente. Hoje:

| Fonte que afeta o líquido     | Onde é lida           | Quem dispara                                       | Falha observada |
|-------------------------------|-----------------------|----------------------------------------------------|------------------|
| Regras de repasse             | `analyze-payment`     | dispatch (sempre)                                  | OK |
| Modelo de remuneração         | `analyze-payment`     | dispatch (sempre)                                  | OK |
| Pool e deduções fixas/mensais | `recalc-payment-pools`| `orchestrate-analysis` ao terminar (sempre)        | OK |
| **Garantia mínima**           | `apply-minimum-guarantee` | `analyze-payment` por PJ (best-effort)         | Pode falhar silenciosamente |
| **Débitos/créditos manuais**  | `apply-company-deductions` | **só quando o analista abre a PJ**            | Materialização ausente em lote isolado/pool |
| **Glosas (médico→PJ)**        | `apply-company-deductions` | mesmo gatilho acima                            | Mesmo problema |
| **Conciliação retroativa**    | `run-retroactive-reconciliation` | só pelo botão da UI                       | Não é re-executada quando o lote é reaberto |
| **Special cases retroativos** | `special-case-adjust` | só pelo dialog da UI                               | Idem |

Resultado: dependendo de **qual tela o analista abre**, o líquido do lote muda. É o oposto do que o nome do produto promete.

## Princípio de correção

> Nenhum lote sai de `em_analise_ia` enquanto o motor não tiver lido **todas** as fontes aplicáveis àquele lote e gravado, com timestamp e contagem, o que foi considerado.

Três pilares:

1. **Pipeline único de finalização** (`finalize-payment-engine`).
2. **Gate de readiness** no banco (não dá pra "esquecer" via UI).
3. **Reatividade**: alterar uma fonte invalida o readiness e re-enfileira o lote automaticamente.

## Mudanças

### 1. Tabela `payment_engine_sources` (nova, auditoria + gate)

Uma linha por (payment_id, source). Cada fonte registra: `read_at`, `applied_count`, `total_value`, `job_id`. Vira a **verdade única** para "o motor leu isso?".

Fontes versionadas:
- `rules` — regras de repasse
- `payout_model` — modelo de remuneração / tabela
- `pool_deductions` — deduções fixas do pool
- `company_adjustments` — créditos/débitos manuais
- `glosa_debts` — glosas médico→PJ
- `minimum_guarantee` — garantia mínima
- `retroactive_reconciliation` — conciliação retroativa
- `special_case_marks` — marcações de caso especial

### 2. `finalize-payment-engine` (nova edge function)

Substitui o trecho que hoje vive em `orchestrate-analysis` "ao terminar". Roda em ordem determinística para cada PJ do lote:

```text
PARA CADA PJ do lote:
   1. apply-company-deductions   (débitos/créditos/glosas)
   2. apply-minimum-guarantee    (item sintético, se cabível)
   3. compute-company-financials (snapshot)
FIM
4. recalc-payment-pools          (uma vez no lote)
5. run-retroactive-reconciliation (somente se houver mark pendente)
6. atualiza payment_engine_sources de cada fonte
```

Toda chamada é idempotente — já tem proteção própria, basta encadear.

### 3. Gate no `recompute_payment_status`

Trigger SQL existente que decide a transição passa a exigir que **todas as fontes aplicáveis** estejam com `read_at >= updated_at do lote`. Se faltar qualquer uma, o lote permanece em `em_analise_ia` com motivo "Aguardando leitura de fontes: <lista>".

A UI já tem o banner de status; só passa a mostrar a lista de fontes pendentes.

### 4. Invalidação automática quando uma fonte muda

Triggers SQL em:
- `company_financial_adjustments` (insert/update/delete)
- `glosa_debts` (status passa a `ativo` ou `confirmed_at` muda)
- `pool_deductions` / `pool_deduction_values`
- `rules` (publicação de nova versão)
- `special_case_marks` (approved)

Cada um faz: para todo `payments` em aberto que aquela fonte afeta → zera `payment_engine_sources.read_at` da fonte correspondente → enfileira chamada de `finalize-payment-engine`.

Resultado: cadastrar débito hoje aparece automaticamente em todos os lotes abertos da PJ. Não depende mais de o analista clicar.

### 5. Watchdog

`analysis-watchdog` ganha um caso novo: para todo lote em `em_analise_ia` há > 5 min com `payment_engine_sources` incompleto, re-invoca `finalize-payment-engine`. Garante recuperação mesmo se uma execução individual falhar.

### 6. UI — card "Fontes lidas pelo motor"

Em `PaymentDetail` e `PoolAnalysis`, ao lado de "Pool calculado":

```text
Fontes lidas pelo motor
✓ Regras                      lido 16:21  · 749 itens
✓ Modelo de remuneração       lido 16:21  · Infectologia
✓ Pool                        lido 16:21  · R$ 45.000 deduzido
✓ Débitos/créditos manuais    lido 16:34  · 1 ajuste (R$ 3.730,90)
✓ Glosas                      lido 16:34  · 0
○ Conciliação retroativa      pendente
```

Botão "Forçar releitura" no card — chama `finalize-payment-engine` direto.

## Detalhes técnicos

**Schema:**

```sql
CREATE TABLE public.payment_engine_sources (
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  source text NOT NULL,
  read_at timestamptz,
  applied_count integer DEFAULT 0,
  total_value numeric DEFAULT 0,
  job_id uuid,
  applicable boolean DEFAULT true,
  PRIMARY KEY (payment_id, source)
);
GRANT SELECT ON public.payment_engine_sources TO authenticated;
GRANT ALL ON public.payment_engine_sources TO service_role;
ALTER TABLE public.payment_engine_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leitura por usuário do hospital do lote"
  ON public.payment_engine_sources FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id
                 AND p.hospital_id IN (SELECT hospital_id FROM user_hospitals WHERE user_id = auth.uid())));
```

**Função de gate (substitui parte de `recompute_payment_status`):**

```sql
CREATE OR REPLACE FUNCTION public.engine_sources_ready(_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM payment_engine_sources
    WHERE payment_id = _payment_id AND applicable = true AND read_at IS NULL
  );
$$;
```

**Ordem em `finalize-payment-engine`:** sequencial por PJ (concurrency=4 entre PJs), porque débito altera o que `compute-company-financials` precisa gravar. Cada PJ é independente.

**Idempotência:** todas as edge functions chamadas já são idempotentes hoje (proposto/confirmado, UNIQUE parciais, etc.) — não precisamos refatorá-las.

**Compatibilidade:** lotes antigos sem registros em `payment_engine_sources` são tratados como `applicable=false` (não bloqueia). Backfill rápido: ao primeiro `finalize-payment-engine` do lote, popular a tabela com as fontes que existem.

## Critérios de aceite

1. Cadastrar um débito em /financeiro/creditos-debitos para uma PJ com lote aberto → ao recarregar o lote, o débito já está aplicado, sem clicar em nada.
2. Reaplicar regras de um lote → todas as 8 fontes são re-lidas; readiness vai a 100%.
3. Lote em `em_analise_ia` com fonte pendente não consegue ir para `revisao_analista` (nem por SQL direto, nem por UI).
4. UI mostra, antes do envio para validação, a lista do que o motor leu, com timestamps.
5. Watchdog recupera lotes que ficaram com fonte pendente por mais de 5 min.

## O que sai do escopo desta entrega

- Refazer a UI de cadastro de débitos/créditos/glosas (já funcional).
- Mudar a lógica de cada source individualmente — só o orquestrador e o gate são novos.
- Migração histórica de auditoria para lotes já fechados.
