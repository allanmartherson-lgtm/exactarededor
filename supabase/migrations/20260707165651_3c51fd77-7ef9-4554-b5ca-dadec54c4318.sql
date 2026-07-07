-- cancel_company_group_payment
CREATE OR REPLACE FUNCTION public.cancel_company_group_payment(p_group_id uuid, p_reason payment_cancellation_reason, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_prev_status payment_status;
BEGIN
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.payment_company_groups g JOIN public.payments p ON p.id=g.payment_id WHERE g.id = p_group_id));
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public._assert_can_cancel_group(p_group_id);
  SELECT payment_id, company_id, status
    INTO v_payment_id, v_company_id, v_prev_status
    FROM public.payment_company_groups
   WHERE id = p_group_id;
  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF v_prev_status = 'cancelado'::payment_status THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  UPDATE public.payment_items
     SET is_cancelled = true,
         cancelled_at = COALESCE(cancelled_at, now()),
         cancelled_by = COALESCE(cancelled_by, v_uid),
         cancellation_reason = COALESCE(cancellation_reason, p_reason),
         cancellation_note = COALESCE(cancellation_note, p_note)
   WHERE payment_id = v_payment_id AND company_id = v_company_id AND is_cancelled = false;
  UPDATE public.payment_company_groups
     SET cancellation_previous_status = v_prev_status,
         status = 'cancelado'::payment_status,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         updated_at = now()
   WHERE id = p_group_id;
  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, diff, hospital_id, company_id)
  SELECT v_uid, 'deleted', 'payment', p_group_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'previous_status', v_prev_status, 'op', 'cancel_company_group_payment'),
         p.hospital_id, v_company_id
  FROM public.payments p WHERE p.id = v_payment_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- cancel_item_payment
CREATE OR REPLACE FUNCTION public.cancel_item_payment(p_item_id uuid, p_reason payment_cancellation_reason, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_group_id uuid;
  v_total int; v_cancel int;
BEGIN
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.payment_items i JOIN public.payments p ON p.id=i.payment_id WHERE i.id = p_item_id));
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT pi.payment_id, pi.company_id INTO v_payment_id, v_company_id
  FROM public.payment_items pi WHERE pi.id = p_item_id;
  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  SELECT id INTO v_group_id FROM public.payment_company_groups
   WHERE payment_id = v_payment_id AND company_id = v_company_id LIMIT 1;
  IF v_group_id IS NOT NULL THEN
    PERFORM public._assert_can_cancel_group(v_group_id);
  END IF;
  UPDATE public.payment_items
     SET is_cancelled = true,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         cancellation_reactivated_at = NULL,
         cancellation_reactivated_by = NULL
   WHERE id = p_item_id AND is_cancelled = false;
  IF v_group_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE is_cancelled)
      INTO v_total, v_cancel
      FROM public.payment_items
     WHERE payment_id = v_payment_id AND company_id = v_company_id;
    IF v_total > 0 AND v_cancel = v_total THEN
      UPDATE public.payment_company_groups
         SET cancellation_previous_status = COALESCE(cancellation_previous_status, status),
             status = 'cancelado'::payment_status,
             cancelled_at = COALESCE(cancelled_at, now()),
             cancelled_by = COALESCE(cancelled_by, v_uid),
             cancellation_reason = COALESCE(cancellation_reason, p_reason),
             cancellation_note = COALESCE(cancellation_note, 'Cancelado automaticamente — todos os itens cancelados'),
             updated_at = now()
       WHERE id = v_group_id AND status <> 'cancelado'::payment_status;
    END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, diff, hospital_id, company_id)
  SELECT v_uid, 'deleted', 'payment_item', p_item_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'group_promoted', (v_total > 0 AND v_cancel = v_total), 'op', 'cancel_item_payment'),
         p.hospital_id, v_company_id
  FROM public.payments p WHERE p.id = v_payment_id;
  RETURN jsonb_build_object('ok', true, 'group_promoted', (v_total > 0 AND v_cancel = v_total));
END;
$function$;

-- conclude_historico_payment
CREATE OR REPLACE FUNCTION public.conclude_historico_payment(_payment_id uuid)
 RETURNS TABLE(updated_count integer, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_import_mode text;
  v_cur_status text;
  v_updated integer := 0;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = _payment_id));
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'analista'::app_role) OR
    public.has_role(v_uid, 'admin'::app_role) OR
    public.has_role(v_uid, 'diretor'::app_role)
  ) THEN
    RAISE EXCEPTION 'sem permissão para concluir importação histórica';
  END IF;
  SELECT import_mode, status::text
    INTO v_import_mode, v_cur_status
  FROM public.payments
  WHERE id = _payment_id
  FOR UPDATE;
  IF v_import_mode IS NULL THEN
    RAISE EXCEPTION 'pagamento não encontrado';
  END IF;
  IF v_import_mode <> 'historico' THEN
    RAISE EXCEPTION 'apenas pagamentos de importação histórica podem ser concluídos por esta ação';
  END IF;
  PERFORM 1
  FROM public.payment_company_groups
  WHERE payment_id = _payment_id
    AND status NOT IN ('pago','rejeitado','cancelado','arquivado')
  ORDER BY id
  FOR UPDATE;
  WITH upd AS (
    UPDATE public.payment_company_groups
    SET status = 'pago',
        approved_at = COALESCE(approved_at, now()),
        approved_by = COALESCE(approved_by, v_uid),
        approval_source = CASE
          WHEN COALESCE(approval_source, 'system') = 'system' THEN 'outro'
          ELSE approval_source
        END,
        approval_registered_by = COALESCE(approval_registered_by, v_uid),
        approval_external_note = COALESCE(
          approval_external_note,
          'Conclusão de importação histórica; não representa aprovação assistencial do fluxo regular.'
        ),
        updated_at = now()
    WHERE payment_id = _payment_id
      AND status NOT IN ('pago','rejeitado','cancelado','arquivado')
    RETURNING 1
  )
  SELECT count(*)::int INTO v_updated FROM upd;
  UPDATE public.payments
  SET status = 'pago',
      approved_at = COALESCE(approved_at, now()),
      updated_at = now()
  WHERE id = _payment_id;
  INSERT INTO public.payment_observations(payment_id, author_type, message, status_from, status_to)
  VALUES (_payment_id, 'sistema',
          format('Importação histórica concluída pelo analista: %s grupo(s) marcado(s) como pago.', v_updated),
          v_cur_status::payment_status, 'pago'::payment_status);
  RETURN QUERY SELECT v_updated, format('%s grupo(s) concluído(s).', v_updated);
END;
$function$;

-- delete_parecer_report
CREATE OR REPLACE FUNCTION public.delete_parecer_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.payment_parecer_reports r JOIN public.payments p ON p.id=r.payment_id WHERE r.id = p_report_id));
  PERFORM set_config('statement_timeout', '300000', true);
  UPDATE public.payment_items
     SET parecer_report_row_id = NULL
   WHERE parecer_report_row_id IN (
     SELECT id FROM public.payment_parecer_report_rows
      WHERE report_id = p_report_id
   );
  DELETE FROM public.payment_parecer_report_rows WHERE report_id = p_report_id;
  DELETE FROM public.payment_parecer_reports     WHERE id = p_report_id;
END;
$function$;

-- delete_payment_batch
CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  SET LOCAL statement_timeout = '60s';
  SET LOCAL session_replication_role = 'replica';
  SELECT status INTO v_status FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lote não encontrado');
  END IF;
  IF v_status NOT IN ('rascunho', 'em_analise_ia', 'revisao_analista') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Lote não pode ser excluído no status "%s". Apenas lotes em rascunho ou análise podem ser excluídos.', v_status)
    );
  END IF;
  UPDATE public.payment_observations
    SET answered_by_observation_id = NULL
    WHERE payment_id = p_payment_id;
  DELETE FROM public.audit_log
    WHERE entity_type = 'payment' AND entity_id = p_payment_id;
  DELETE FROM public.ai_analysis_versions WHERE payment_id = p_payment_id;
  DELETE FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;