CREATE OR REPLACE FUNCTION public.is_valid_status_transition(_from payment_status, _to payment_status)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _from IS NULL THEN true
    WHEN _from = _to THEN true
    WHEN _from = 'rascunho' AND _to IN ('em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'em_analise_ia' AND _to IN ('revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'revisao_analista' AND _to IN ('aguardando_validacao','em_analise_ia','cancelado','aguardando_aprovacao') THEN true
    WHEN _from = 'aguardando_validacao' AND _to IN ('aguardando_aprovacao','devolvido_analista','cancelado') THEN true
    WHEN _from = 'devolvido_analista' AND _to IN ('aguardando_validacao','aguardando_aprovacao','em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'devolvido_validador' AND _to IN ('aguardando_validacao','revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'aguardando_aprovacao' AND _to IN ('aprovado','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'aprovado' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','aprovado_com_ressalva','cancelado') THEN true
    WHEN _from = 'aprovado_com_ressalva' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','cancelado') THEN true
    WHEN _from = 'pedido_nf_enviado' AND _to IN ('nf_recebida','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_recebida' AND _to IN ('nf_conciliada','nf_divergente','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_questionada' AND _to IN ('nf_recebida','nf_conciliada','nf_divergente','cancelado') THEN true
    WHEN _from = 'nf_divergente' AND _to IN ('nf_conciliada','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_conciliada' AND _to IN ('lancado','pago','cancelado') THEN true
    WHEN _from = 'lancado' AND _to IN ('pago','cancelado') THEN true
    ELSE false
  END;
$function$;

-- Atualiza recompute para reconhecer 'lancado' como estado intermediário válido
CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_groups integer;
  s_aprovado integer;
  s_rejeitado integer;
  s_cancelado integer;
  s_em_analise integer;
  s_revisao integer;
  s_dev_analista integer;
  s_dev_validador integer;
  s_aguard_val integer;
  s_aguard_apr integer;
  new_status public.payment_status;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'aprovado'),
    count(*) FILTER (WHERE status = 'rejeitado'),
    count(*) FILTER (WHERE status = 'cancelado'),
    count(*) FILTER (WHERE status = 'em_analise_ia'),
    count(*) FILTER (WHERE status = 'revisao_analista'),
    count(*) FILTER (WHERE status = 'devolvido_analista'),
    count(*) FILTER (WHERE status = 'devolvido_validador'),
    count(*) FILTER (WHERE status = 'aguardando_validacao'),
    count(*) FILTER (WHERE status = 'aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_dev_validador, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups
  WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN RETURN; END IF;

  IF s_em_analise > 0 THEN new_status := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
  ELSIF s_dev_validador > 0 THEN new_status := 'devolvido_validador';
  ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN new_status := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN new_status := 'rejeitado';
    ELSE new_status := 'cancelado';
    END IF;
  ELSE
    new_status := 'aguardando_validacao';
  END IF;

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
     SET status = new_status, updated_at = now()
   WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;
