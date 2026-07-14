
# Bloco 2 — Resolver ambiguidade Parecer × Visita

Contexto: `parecer_adulto` e `visita` compartilham `tuss_default=10102019`. Na cadeia de reanálise, `auto-classify-payment-types` roda DEPOIS do `cross-reference-parecer`, então pode sobrescrever a classificação correta se não estiver blindado.

## Verificações concluídas

**Constraint atual** (`payment_items_item_type_source_check`):
```
manual, auto_tuss, auto_default, auto_heuristic, backfill_tuss,
backfill_default, backfill_from_payment_type, inherit,
report_cross, report_cross_dedup
```
→ NÃO contém `ambiguous_tuss`. Migration OBRIGATÓRIA antes do código.
→ NÃO contém `company_override` nem `base_tipo` (usados só como constantes de blindagem futura em `cross-reference-parecer` — não vamos gerar UPDATEs com esses valores).

**Degradação com `item_type_id = NULL` — SEGURA**:
- `rulesEngine.ts:1804-1837`: cálculo tipado com `item.item_type_id = null` retorna `{ ok: false, reason: 'item_type_nao_corresponde' }`. Sem exceção. Item cai em cálculo universal (sem tipo) ou vira `sem_regra`/alerta.
- `calcOverlap.ts:232-237`: null tratado explicitamente.
- `analyze-payment/index.ts:818`: `(it as any).item_type_id ?? null` — já é nullable.

Conclusão: lote misto sem relatório com itens ambíguos ficará com esses itens em `sem_regra` visível ao analista, sem quebra. Ao subir o relatório, cross-ref preenche e reanálise resolve.

## Ordem de execução

1. **Migration** (aprovação separada) — ampliar constraint.
2. **Edge** `auto-classify-payment-types` + redeploy.
3. **UI** `src/pages/ItemTypes.tsx`.
4. **UPDATE de depreciação** (aprovação separada).

---

## Passo 1 — Migration (aguardando aprovação)

```sql
ALTER TABLE public.payment_items
  DROP CONSTRAINT payment_items_item_type_source_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_item_type_source_check
  CHECK (
    item_type_source IS NULL OR item_type_source = ANY (ARRAY[
      'manual','auto_tuss','auto_default','auto_heuristic',
      'backfill_tuss','backfill_default','backfill_from_payment_type',
      'inherit','report_cross','report_cross_dedup',
      'ambiguous_tuss'
    ])
  );
```

Sem backfill de dados, sem outras alterações.

---

## Passo 2 — `supabase/functions/auto-classify-payment-types/index.ts` (edge, redeploy)

**Estado atual** (linhas 28-32): `PROTECTED_SOURCES = {'manual', 'report_cross', 'report_cross_dedup'}`.

**Mudanças:**

- Ampliar `PROTECTED_SOURCES` incluindo `'company_override'` e `'base_tipo'` — blindagem futura, alinha com `cross-reference-parecer:63`. Não gera nenhum código que assuma esses valores como emitidos aqui.
- Trocar `tussToItemType: Map<string, string>` por `Map<string, Set<string>>` acumulando todos os `item_type_id` ativos que reivindicam cada código (tuss_default + tuss_codes_extra).
- Nova decisão por item com `procedure_code`:
  - `set.size === 1` → `auto_tuss` (comportamento atual).
  - `set.size > 1` → AMBÍGUO: `item_type_id = null`, `item_type_source = 'ambiguous_tuss'`.
- Bucket dedicado `ambiguous_tuss`. **Chave de bucket** precisa aceitar `item_type_id = null` → usar sentinela na string:
  ```ts
  const bucketKey = nextItemTypeId
    ? `${nextItemTypeId}::${nextSource}`
    : `__NULL__::${nextSource}`;
  ```
  No dispatch do UPDATE, se a chave começa com `__NULL__::`, gravar `item_type_id: null`.
- **Skip unchanged para ambíguo**: se `it.item_type_source === 'ambiguous_tuss' && it.item_type_id === null && nextSource === 'ambiguous_tuss'` → conta `unchanged`, não enfileira.
- Contador `ambiguousTuss` + campo `ambiguous_tuss: number` na resposta e no log.
- Trocar warning `TUSS duplicados` por log `TUSS ambíguos: N códigos [amostra]`.

Fluxo esperado:

```text
Lote de Parecer, item TUSS 10102019:
  auto-classify   → item_type_source=ambiguous_tuss, item_type_id=null
  cross-reference → item_type_source=report_cross, item_type_id=<parecer|visita>
  rerun auto-cls  → PROTECTED_SOURCES bloqueia sobrescrita ✓
```

---

## Passo 3 — `src/pages/ItemTypes.tsx`

- Calcular em memória `tuss → Set<item_type_id>` a partir de `list.filter(p => p.active)` cruzando `tuss_default ∪ tuss_codes_extra`.
- Marcar cada tipo cujo qualquer TUSS aparece em outro tipo ativo como `hasAmbiguity`.
- Adicionar badge `Ambíguo` (variant destructive/amber) ao lado dos badges TUSS (linhas 299-308) com tooltip listando os outros tipos que colidem em cada código.
- `Alert` no topo da lista quando `count > 0`: "N tipo(s) ativos compartilham TUSS. Esses códigos não são classificados automaticamente — o motor de Parecer/Visita ou override manual decide."
- Cadastrar TUSS colidente continua permitido (é o caso legítimo Parecer × Visita). Sem mudança de schema/validação.

---

## Passo 4 — Depreciação do parâmetro (aguardando aprovação separada, executar via `insert`)

```sql
UPDATE system_parameter_defs
SET description = '[DEPRECATED — substituído pelo motor determinístico de primeiro contato em jul/2026] ' || description
WHERE key = 'parecer.classification'
  AND description NOT LIKE '[DEPRECATED%';
```

Não deleta a linha, não toca em `system_parameter_overrides`.

---

## Arquivos NÃO tocados

- `supabase/functions/cross-reference-parecer/index.ts` — recém-alterado.
- `supabase/functions/dispatch-payment-analysis/index.ts` — recém-alterado.
- `supabase/functions/analyze-payment/index.ts` — apenas lê `item_type_id`; degradação com null confirmada segura.
- `supabase/functions/_shared/rulesEngine.ts`, `calcOverlap.ts` — degradação com null já correta.
- `src/lib/parsePaymentFile.ts`, `columnMapping.ts`, `reclassifyItemType.ts` — não fazem lookup global TUSS→tipo.
- Hooks e demais telas — apenas consomem.

## Casos de borda

1. TUSS presente em vários tipos, todos menos um inativos → sobra 1 ativo → `auto_tuss` normal.
2. Item já `ambiguous_tuss` que continua ambíguo → não gera UPDATE (`unchanged`).
3. Item `ambiguous_tuss` cujo cadastro voltou a ser único → entra no bucket `auto_tuss` e é normalizado.
4. Item sem TUSS → `auto_default` (ambiguidade só quando há `procedure_code`).
5. Colisão em `tuss_codes_extra` (ex.: dois tipos listam mesmo extra) → ambíguo, igual `tuss_default`.
6. Rerun após cross-ref → itens com `report_cross`/`report_cross_dedup` protegidos.
7. Lote de Consulta pura sem colisão ativa → comportamento idêntico ao atual.
8. Lote misto sem relatório → itens ambíguos ficam sem `item_type_id`; regras tipadas não casam → item vira `sem_regra`/alerta, visível ao analista. Ao subir relatório e reanalisar, cross-ref resolve.

Aguardo aprovação da migration (Passo 1) para prosseguir.
