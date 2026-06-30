
## Contexto

Hoje a tabela `payment_types` mistura dois conceitos:

- **Modelo de pagamento (do lote)** — Produção, Plantão, Remessa, Valor fixo
- **Tipo de item / procedimento (da linha)** — Parecer, Visita, Cirurgia, Consulta, Bônus por paciente, Exames SADT, Exames Cardiologia

Isso causa: dropdowns confusos (`Lote misto detectado` mostra "Produção" como opção de override de item), motor de classificação tratando lote-tipo e item-tipo como mesma chave, e itens não-Consulta caindo silenciosamente em Consulta quando o TUSS existia mas não foi olhado.

## Decisões já aprovadas

1. Duas entidades distintas: `payment_models` (lote) + `item_types` (item)
2. Classificação automática do item: se tem TUSS → tipo derivado do TUSS; sem TUSS → Consulta
3. Reclassificar em lote todos os itens já existentes via TUSS

## Plano

### Etapa 1 — Schema (uma migration)

```text
payment_models                       item_types
─────────────                        ──────────
id (uuid)                            id (uuid)
code (text, único)                   code (text, único)
label (text)                         label (text)
active, sort_order, color            active, sort_order, color
calc_strategy                        default_function
expected_headers                     requires_tuss (bool)
allow_mixed_item_types (bool)        is_default_when_no_tuss (bool)  ← marca "Consulta"
```

Seed inicial:
- `payment_models`: producao, plantao, remessa, valor_fixo
- `item_types`: parecer_adulto, visita, cirurgia, consulta (default), bonus_paciente, sadt, exames_cardiologia

Tabela de ligação TUSS → item_type já existe conceitualmente em `procedure_classifications`; vamos consolidá-la como fonte única (`item_type_id` em `procedure_classifications`).

`payment_types` **não é apagada** nesta etapa — permanece como view de compatibilidade lendo das duas novas tabelas, para o código atual continuar respondendo enquanto migramos.

### Etapa 2 — Colunas nas tabelas operacionais

- `payments.payment_model_id` (novo) ← preenchido a partir de `payment_type_id` quando o atual é um modelo
- `payment_items.item_type_id` (novo) ← preenchido a partir de `payment_type_id` quando o atual é um tipo de item; senão derivado do TUSS
- `rules.payment_model_id` + `rules.item_type_id` (regra pode escopar por um, outro ou ambos)
- Backfill SQL na mesma migration usando o mapa fixo:
  - modelos: producao, plantao, remessa, valor_fixo
  - itens: o resto

### Etapa 3 — Novo classificador de item

Substitui o atual `auto-classify-payment-types` por `classify-item-by-tuss`:

```text
para cada item:
  if procedure_code:
    item_type_id = procedure_classifications[TUSS].item_type_id
    source = 'auto_tuss'
  else:
    item_type_id = item_types.where(is_default_when_no_tuss=true).id  // Consulta
    source = 'auto_default'
```

Remove a heurística de texto atual (`/procedimento|cirurgia|exame/`) — TUSS é a verdade.

### Etapa 4 — UI

- Dropdown do lote: lista só `payment_models`
- Inline select do item (a coluna "Tipo" que acabamos de adicionar): lista só `item_types`, mostra de onde veio (TUSS / Consulta default / manual)
- Filtros do grid de itens: troca "tipo" único por dois filtros separados
- Tela `/payment-types` vira `/payment-models` + `/item-types`

### Etapa 5 — Reclassificação em massa

Edge function `backfill-item-types` (one-shot, com dry-run):
- Para cada `payment_items.procedure_code` não-nulo, aplica `procedure_classifications`
- Marca `payment_type_source='backfill_tuss'` para auditoria
- Re-dispara o motor nos `payments` afetados que **não estão aprovados/pagos**
- Lotes aprovados/pagos: só registra o item_type derivado em coluna paralela `item_type_id_suggested`, não muda o cálculo (preserva auditoria)

### Etapa 6 — Limpeza (em PR separado, depois de estabilizar)

- Remove a view de compatibilidade `payment_types`
- Remove colunas legacy `payment_type_id` de `payments` / `payment_items` / `rules`
- Remove código morto do antigo classificador heurístico

## Riscos e mitigações

- **Regras existentes** podem estar escopadas com um `payment_type_id` que era na verdade misto. Migration emite RAISE NOTICE listando regras ambíguas para revisão manual.
- **DRE/Pools** filtram por `payment_type_id`. Backfill mantém compatibilidade via view até trocarmos consumidor por consumidor.
- **Edge functions** (analyze-payment, dispatch-payment-analysis, simulate-rule, cross-reference-parecer, recalc-payment-pools, apply-company-deductions, validate-payment, zeev-executor) usam `payment_type_id`. Etapa 2 mantém a coluna; só Etapa 6 remove.

## Ordem de execução proposta

1. Migration Etapa 1 + 2 (schema + backfill, com view de compatibilidade) — aprovação sua
2. Edge function nova de classificação + chamadas
3. Ajustes de UI (dropdown lote, inline item, filtros, telas de cadastro)
4. Backfill em massa (Etapa 5) — sob seu comando, com dry-run primeiro
5. Limpeza (Etapa 6) — depois de você confirmar produção estável

Posso começar pela migration da Etapa 1+2?
