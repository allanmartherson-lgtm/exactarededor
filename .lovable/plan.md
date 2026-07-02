## Objetivo

Criar uma view agregadora `v_payment_production_period` que expõe, por `payment_id`, o período de produção real derivado dos itens do lote — sem alterar `payments` nem tocar em frontend.

## Escopo

**Somente uma migration SQL.** Nada de código TS, nada de coluna nova em `payments`, nada de UI.

## Migration

Cria a view exatamente como especificado:

```sql
CREATE OR REPLACE VIEW public.v_payment_production_period AS
SELECT
  pi.payment_id,
  MIN(pi.item_competence) AS production_period_start,
  MAX(pi.item_competence) AS production_period_end,
  array_agg(DISTINCT pi.item_competence ORDER BY pi.item_competence) AS production_months,
  count(*) FILTER (WHERE pi.competence_source = 'payment_month') AS itens_sem_producao_real
FROM public.payment_items pi
GROUP BY pi.payment_id;
```

Mais os GRANTs necessários para o Data API enxergar a view:

```sql
GRANT SELECT ON public.v_payment_production_period TO authenticated;
GRANT SELECT ON public.v_payment_production_period TO service_role;
```

Sem grant para `anon` — segue o padrão auth-only do projeto e o fato de que `payment_items` também não é público.

## Semântica confirmada (para revisão)

- **Sem linha ≠ NULL**: lotes sem itens simplesmente não aparecem na view. Frontend deve tratar ausência como "produção ainda não importada".
- **`production_months`**: array ordenado de `item_competence` distintos (um por mês de produção real).
- **`itens_sem_producao_real`**: contagem de itens cuja competência veio do mês do lote (fallback), útil pra medir cobertura de produção real.
- **RLS**: views herdam permissão do usuário sobre as tabelas base; `payment_items` já tem RLS, então o filtro por hospital continua valendo automaticamente.

## Fora deste plano

- Índice em `payment_items(payment_id, item_competence)` — só se ao consultar a view em produção aparecer lentidão. Não crio agora.
- Qualquer coluna derivada em `payments` (`production_period_start/end`).
- Qualquer uso da view no frontend.
