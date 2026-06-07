---
name: Separação de status Confecção × Análise
description: Confecção tem enum próprio (confeccao_status) e colunas dedicadas; payments.status fica em 'rascunho' como placeholder enquanto mode=confeccao. Trigger DB bloqueia mistura. Transição via RPC finalize_confeccao.
type: feature
---

- Enum `public.confeccao_status`: `em_confeccao | confeccao_concluida | cancelada`.
- Colunas em `payments` e `payment_company_groups`: `confeccao_status`, `confeccao_finalized_at`, `confeccao_finalized_by`.
- Em `analysis_mode='confeccao'` o `status` (enum payment_status) só pode ser `rascunho`, `arquivado` ou `cancelado` — o estado vivo mora em `confeccao_status`.
- Trigger `enforce_confeccao_status_coherence` (BEFORE INSERT/UPDATE em payments e payment_company_groups) garante a separação e impede `confeccao_status='em_confeccao'` quando o modo não é confecção.
- `recompute_payment_status_from_groups` agora, em confecção, deriva apenas `confeccao_status` agregando os grupos; não toca em `status`.
- Transição Confecção → Análise: RPC `public.finalize_confeccao(_payment_id)` — troca `analysis_mode` para `padrao`, marca `confeccao_status='confeccao_concluida'`, libera grupos para `revisao_analista` e dispara `analyze-payment` via `dispatch-payment-analysis`.
- Frontend: `isConfeccao = analysis_mode==='confeccao'`; `isConfeccaoEditable = confeccao_status==='em_confeccao'`. Nunca usar `gStatus === 'em_confeccao'` para gate operacional (sobrou só como valor legado no enum).
- Edge `dispatch-payment-analysis`: o gate em modo confecção valida `confeccao_status='em_confeccao'` (não `status`).
- Edge `analyze-payment`: ao criar/atualizar grupo em confecção, escrever `status='rascunho'` + `confeccao_status='em_confeccao'`.
- Valor `em_confeccao` permanece no enum `payment_status` apenas por compatibilidade histórica; novo código nunca o escreve.
