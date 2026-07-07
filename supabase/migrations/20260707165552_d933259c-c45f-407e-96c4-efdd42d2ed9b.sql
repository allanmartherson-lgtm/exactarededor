-- admin_clear_company_items
CREATE OR REPLACE FUNCTION public.admin_clear_company_items(_payment_id uuid, _company_name text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = _payment_id));
  PERFORM set_config('statement_timeout', '0', true);
  UPDATE public.doctor_messages SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name);
  UPDATE public.reconciliation_items SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name);
  UPDATE public.reconciliation_items SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name);
  UPDATE public.glosa_items SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name);
  UPDATE public.production_validation_feedbacks SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name);
  WITH del AS (
    DELETE FROM public.payment_items WHERE payment_id = _payment_id AND company_name = _company_name RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$function$;

-- admin_delete_payment
CREATE OR REPLACE FUNCTION public.admin_delete_payment(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
 SET lock_timeout TO '0'
AS $function$
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = _payment_id));
  PERFORM pg_advisory_xact_lock(hashtext('admin_delete_payment:' || _payment_id::text));
  UPDATE public.doctor_messages SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);
  UPDATE public.reconciliation_items SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);
  UPDATE public.reconciliation_items SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);
  UPDATE public.glosa_items SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);
  UPDATE public.production_validation_feedbacks SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);
  UPDATE public.doctor_messages SET payment_id = NULL WHERE payment_id = _payment_id;
  UPDATE public.glosa_debts SET last_payment_id = NULL WHERE last_payment_id = _payment_id;
  UPDATE public.glosa_items SET applied_payment_id = NULL WHERE applied_payment_id = _payment_id;
  UPDATE public.glosa_items SET matched_payment_id = NULL WHERE matched_payment_id = _payment_id;
  UPDATE public.pendencias SET payment_id = NULL WHERE payment_id = _payment_id;
  UPDATE public.reconciliation_items SET applied_payment_id = NULL WHERE applied_payment_id = _payment_id;
  UPDATE public.user_company_notes SET payment_id = NULL WHERE payment_id = _payment_id;
  DELETE FROM public.user_company_notes
   WHERE group_id IN (SELECT id FROM public.payment_company_groups WHERE payment_id = _payment_id);
  DELETE FROM public.payment_unmatched_items WHERE payment_id = _payment_id;
  DELETE FROM public.payment_items           WHERE payment_id = _payment_id;
  DELETE FROM public.payment_observations    WHERE payment_id = _payment_id;
  DELETE FROM public.payment_company_groups  WHERE payment_id = _payment_id;
  DELETE FROM public.payments                WHERE id = _payment_id;
END;
$function$;

-- approve_campaign
CREATE OR REPLACE FUNCTION public.approve_campaign(_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.comm_campaigns WHERE id = _campaign_id));
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'diretor')
     AND NOT public.has_role(auth.uid(), 'validador') THEN
    RAISE EXCEPTION 'Apenas validador, admin ou diretor podem aprovar campanhas';
  END IF;
  UPDATE public.comm_campaigns
     SET approval_status = 'approved',
         approved_by     = auth.uid(),
         approved_at     = now(),
         rejection_reason = NULL
   WHERE id = _campaign_id
     AND approval_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada ou já processada';
  END IF;
END;
$function$;

-- approve_payment
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
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