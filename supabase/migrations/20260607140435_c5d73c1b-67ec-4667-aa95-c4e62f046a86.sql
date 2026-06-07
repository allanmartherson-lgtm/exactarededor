-- Conserta lotes/grupos em modo CONFECÇÃO que ficaram com status de ANÁLISE
-- após a separação (backfill anterior só pegava status='em_confeccao').
-- Sintoma: trigger enforce_confeccao_status_coherence bloqueia qualquer UPDATE
-- com "payments.status=revisao_analista não é permitido".

SET LOCAL session_replication_role = 'replica';

-- Lotes: leva status para placeholder e marca confeccao_status='em_confeccao'.
UPDATE public.payments
   SET status = 'rascunho',
       confeccao_status = COALESCE(confeccao_status, 'em_confeccao'),
       updated_at = now()
 WHERE analysis_mode = 'confeccao'
   AND status NOT IN ('rascunho','arquivado','cancelado');

-- Grupos: mesma normalização.
UPDATE public.payment_company_groups g
   SET status = 'rascunho',
       confeccao_status = COALESCE(g.confeccao_status, 'em_confeccao'),
       updated_at = now()
  FROM public.payments p
 WHERE p.id = g.payment_id
   AND p.analysis_mode = 'confeccao'
   AND g.status NOT IN ('rascunho','arquivado','cancelado');

SET LOCAL session_replication_role = 'origin';