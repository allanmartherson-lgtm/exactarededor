-- 1) Ensina recompute_payment_status_from_groups a propagar em_confeccao.
CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_groups   integer;
  s_aprovado     integer; s_rejeitado    integer; s_cancelado    integer;
  s_em_analise   integer; s_revisao      integer; s_concluida    integer;
  s_dev_analista integer; s_aguard_val   integer; s_aguard_apr   integer;
  s_apr_revisao  integer; s_arquivado    integer; s_questionado  integer;
  s_rev_pos_apr  integer; s_pedido_nf    integer; s_nf_recebida  integer;
  s_nf_concil    integer; s_lancado      integer; s_pago         integer;
  s_em_confeccao integer;
  has_active_job boolean;
  cur_status     public.payment_status;
  new_status     public.payment_status;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'aprovado'),
    count(*) FILTER (WHERE status = 'rejeitado'),
    count(*) FILTER (WHERE status = 'cancelado'),
    count(*) FILTER (WHERE status = 'em_analise_ia'),
    count(*) FILTER (WHERE status = 'revisao_analista'),
    count(*) FILTER (WHERE status = 'concluida_analista'),
    count(*) FILTER (WHERE status = 'devolvido_analista'),
    count(*) FILTER (WHERE status = 'aguardando_validacao'),
    count(*) FILTER (WHERE status = 'aguardando_aprovacao'),
    count(*) FILTER (WHERE status = 'aprovado_em_revisao'),
    count(*) FILTER (WHERE status = 'arquivado'),
    count(*) FILTER (WHERE status = 'em_questionamento'),
    count(*) FILTER (WHERE status = 'revisao_pos_aprovacao'),
    count(*) FILTER (WHERE status = 'pedido_nf_enviado'),
    count(*) FILTER (WHERE status = 'nf_recebida'),
    count(*) FILTER (WHERE status = 'nf_conciliada'),
    count(*) FILTER (WHERE status = 'lancado'),
    count(*) FILTER (WHERE status = 'pago'),
    count(*) FILTER (WHERE status = 'em_confeccao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado,
       s_em_analise, s_revisao, s_concluida, s_dev_analista,
       s_aguard_val, s_aguard_apr, s_apr_revisao, s_arquivado,
       s_questionado, s_rev_pos_apr, s_pedido_nf, s_nf_recebida,
       s_nf_concil, s_lancado, s_pago, s_em_confeccao
  FROM public.payment_company_groups WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN RETURN; END IF;

  SELECT status INTO cur_status FROM public.payments WHERE id = _payment_id;

  SELECT EXISTS (
    SELECT 1 FROM public.payment_processing_jobs
    WHERE payment_id = _payment_id AND status = 'em_andamento'
  ) INTO has_active_job;

  IF s_em_confeccao > 0 THEN
    -- Confecção tem prioridade absoluta: enquanto algum grupo estiver em confecção,
    -- o lote inteiro permanece em confecção (o motor confecção não altera grupo após calcular).
    new_status := 'em_confeccao';
  ELSIF has_active_job AND cur_status IN ('rascunho', 'em_analise_ia', 'revisao_analista', 'devolvido_analista', 'em_confeccao') THEN
    new_status := 'em_analise_ia';
  ELSIF s_em_analise   > 0 THEN new_status := 'em_analise_ia';
  ELSIF s_revisao   > 0 OR s_concluida > 0 THEN new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
  ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 OR s_questionado > 0 THEN new_status := 'aguardando_aprovacao';
  ELSIF s_apr_revisao > 0 OR s_rev_pos_apr > 0 THEN new_status := 'revisao_pos_aprovacao';
  ELSIF s_pedido_nf > 0 OR s_nf_recebida > 0 THEN new_status := 'pedido_nf_enviado';
  ELSIF s_arquivado = total_groups THEN new_status := 'arquivado';
  ELSIF s_nf_concil > 0 AND (s_nf_concil + s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado + s_questionado) = total_groups THEN
    new_status := 'nf_conciliada';
  ELSIF (s_lancado + s_pago) > 0 AND (s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado) = total_groups THEN
    new_status := 'lancado';
  ELSIF s_pago = total_groups THEN new_status := 'pago';
  ELSE new_status := 'aguardando_aprovacao';
  END IF;

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;

-- 2) Backfill: grupos de lotes legados em modo confecção que ainda estavam em
-- rascunho/em_analise_ia/revisao_analista passam para em_confeccao.
DO $$
DECLARE
  pid uuid;
BEGIN
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payment_company_groups g
  SET status = 'em_confeccao'
  FROM public.payments p
  WHERE g.payment_id = p.id
    AND p.analysis_mode = 'confeccao'
    AND g.status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista');

  FOR pid IN
    SELECT id FROM public.payments
    WHERE analysis_mode = 'confeccao'
      AND status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista')
  LOOP
    PERFORM public.recompute_payment_status_from_groups(pid);
  END LOOP;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END $$;