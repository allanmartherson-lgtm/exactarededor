CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer;
BEGIN
  IF NOT (public.has_role(p_author_id, 'diretor'::public.app_role) OR public.has_role(p_author_id, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas diretor pode realizar a aprovação final.';
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'revisao_pos_aprovacao',
      approved_by = p_author_id,
      approved_at = now(),
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status = 'aguardando_aprovacao';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Aprovação final bloqueada: todas as empresas precisam estar na etapa de aprovação do diretor.';
  END IF;

  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.payment_observations(
      payment_id, author_id, author_type, message,
      status_from, status_to, observation_type
    ) VALUES (
      p_payment_id, p_author_id, 'diretor'::public.observation_author, p_note,
      'aguardando_aprovacao'::public.payment_status,
      'revisao_pos_aprovacao'::public.payment_status,
      'informativo'::public.observation_type
    );
  END IF;

  -- Seta approved_at no payment se todos os grupos saíram do fluxo pré-aprovação
  UPDATE public.payments p
  SET approved_at = now()
  WHERE p.id = p_payment_id
    AND p.approved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_company_groups g
      WHERE g.payment_id = p.id
      AND g.status NOT IN (
        'revisao_pos_aprovacao','aprovado','aprovado_com_ressalva',
        'pedido_nf_enviado','nf_recebida','nf_questionada',
        'nf_divergente','nf_conciliada','lancado','pago',
        'arquivado','rejeitado','cancelado','aprovado_parcial',
        'aprovado_em_revisao'
      )
    );

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;