---
name: Transições de status em massa devem ser atômicas
description: Mudança de status de muitos grupos (envio para validação, conclusão em massa) sempre via RPC SECURITY DEFINER única — nunca loop client-side
type: feature
---

Loops client-side de `UPDATE` por grupo (com `await` sequencial e `continue` em erro) deixam grupos travados em estado intermediário quando algumas chamadas falham silenciosamente (RLS, AbortError de refresh token "Lock broken by another request with the 'steal' option", throttling do PostgREST, navegação prematura).

Regra: toda transição em massa de `payment_company_groups.status` deve usar uma RPC SECURITY DEFINER que executa um único `UPDATE ... WHERE id = ANY($1)` e retorna `(updated_count, skipped_count, message)`. Histórico/notificações por grupo são best-effort em `Promise.allSettled` após a RPC, nunca dentro de um loop serial bloqueante.

RPCs existentes:
- `bulk_conclude_analyst_groups(_payment_id, _group_ids)` — revisao_analista → concluida_analista
- `bulk_send_groups_to_validation(_payment_id, _group_ids)` — {concluida_analista|devolvido_analista|revisao_analista} → aguardando_validacao
