# Fase E — Próximas etapas

Contexto: Item 1 (Card "Lotes esperados em atraso" no BI) já entregue. Restam três itens da fase.

## Item 2 — Anomalia por volume de itens

**Objetivo:** detectar quando um lote vinculado a um padrão recorrente vem com volume de itens muito fora da média histórica daquele padrão (indício de base incompleta ou duplicada).

**Backend (1 migration):**
- Nova RPC `get_pattern_volume_anomalies(p_hospital_id uuid)` que, para cada `payment_batch_pattern_id`:
  - calcula média e desvio padrão de `payment_items` por lote nos últimos 6 meses vinculados ao padrão;
  - retorna lotes do mês vigente cujo count desvia >40% da média (ou >2σ, o que for maior);
  - devolve: `payment_id`, `payment_name`, `pattern_label`, `expected_avg`, `actual_count`, `deviation_pct`, `direction` (baixo/alto).

**Frontend (1 arquivo):**
- `src/pages/BiDiretoria.tsx`: adicionar card **"Anomalias de volume por padrão"** ao lado do card de "Anomalias de lote" existente, com tabela (Padrão | Lote | Esperado | Real | Δ%) e badge vermelho/âmbar.

## Item 3 — Notificações de padrão em atraso

**Objetivo:** analista recebe notificação interna quando um padrão recorrente ultrapassa o prazo esperado sem lote importado.

**Backend:**
- Nova Edge Function `notify-missing-batch-patterns` (cron diário 08:00):
  - itera `get_missing_batch_patterns()` por hospital;
  - insere em `internal_notifications` (uma por padrão em atraso, dedup por dia via chave `payment_batch_pattern_id + due_date`);
  - severity conforme dias em atraso (≥15d = alta, ≥7d = média).
- Adicionar `verify_jwt = false` no `config.toml` + `requireInternalOrRole` no código.
- Registrar cron via `supabase--insert` (pg_cron/pg_net, conforme padrão do projeto).

**Frontend:** nenhum arquivo novo — o sino de notificações existente já consome `internal_notifications`.

## Item 4 — Filtros por padrão na listagem de lotes

**Objetivo:** filtrar `src/pages/Payments.tsx` por `payment_batch_pattern_id` (recorrente vs avulso, ou padrão específico).

**Backend:**
- Estender RPC `list_payments` com parâmetro `p_batch_pattern_ids uuid[]` e `p_only_unlinked boolean`.

**Frontend (1 arquivo):**
- `src/pages/Payments.tsx`: adicionar `MultiSelectPopover` "Padrão de lote" nos filtros avançados, alimentado por `payment_batch_patterns` do hospital ativo, com opção "Sem padrão vinculado".

## Arquivos afetados (resumo)

```text
supabase/migrations/<novo>.sql               (item 2 + item 4 combinados)
supabase/functions/notify-missing-batch-patterns/index.ts   (novo, item 3)
supabase/config.toml                          (item 3, verify_jwt)
src/pages/BiDiretoria.tsx                     (item 2)
src/pages/Payments.tsx                        (item 4)
```

## Riscos e observações

- **Compartilhado:** `Payments.tsx` e `list_payments` são usados em vários fluxos. A extensão é aditiva (novos parâmetros opcionais), sem quebrar chamadas atuais — mas confirmo antes de tocar.
- **Cron:** requer `pg_cron` + `pg_net` habilitados. Confirmo antes do insert.
- **Ordem sugerida:** 2 → 4 → 3 (deixar cron por último para validar RPCs antes).

Confirma a ordem e o escopo? Posso ajustar (ex.: entregar só o item 2 agora, adiar cron etc.).
