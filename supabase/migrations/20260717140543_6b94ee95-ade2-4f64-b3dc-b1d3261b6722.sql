
-- Fix ambiguidade "id" na RPC de prévia (bloqueia visualização em lotes em revisão)
CREATE OR REPLACE FUNCTION public.get_lote_intervention_preview(p_payment_id uuid)
 RETURNS TABLE(id uuid, payment_id uuid, item_id uuid, company_id uuid, company_name text, doctor_name text, procedure_code text, procedure_name text, valor_regra numeric, valor_pago_final numeric, delta numeric, fonte text, cancellation_reason text, autor_id uuid, approved_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital_id uuid;
  v_glosa jsonb := '{}'::jsonb;
  v_accept_expected_cutoff constant timestamptz := '2026-07-01 00:00:00+00';
BEGIN
  SELECT p.hospital_id INTO v_hospital_id FROM public.payments p WHERE p.id = p_payment_id;
  IF v_hospital_id IS NULL THEN RETURN; END IF;
  PERFORM public.assert_hospital_access(v_hospital_id);

  SELECT COALESCE(jsonb_object_agg(g.company_id::text, true), '{}'::jsonb)
    INTO v_glosa
    FROM (
      SELECT DISTINCT gpa.company_id
      FROM public.glosa_payment_applications gpa
      WHERE gpa.payment_id = p_payment_id AND gpa.reverted_at IS NULL
    ) g;

  RETURN QUERY
  SELECT * FROM public.get_lote_intervention_preview_inner(p_payment_id, v_hospital_id, v_glosa, v_accept_expected_cutoff);
END;
$function$;
