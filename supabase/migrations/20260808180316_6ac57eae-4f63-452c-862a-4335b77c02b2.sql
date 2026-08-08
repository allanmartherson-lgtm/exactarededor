CREATE OR REPLACE FUNCTION public.reimport_company_items(
  p_payment_id uuid,
  p_company_name text,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital uuid;
  v_uid uuid := auth.uid();
  v_removed integer := 0;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_payment_id IS NULL OR coalesce(btrim(p_company_name), '') = '' THEN
    RAISE EXCEPTION 'missing_params';
  END IF;

  SELECT hospital_id INTO v_hospital FROM public.payments WHERE id = p_payment_id;
  IF v_hospital IS NULL THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'diretor'::app_role)
    OR public.has_role(v_uid, 'analista'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF NOT public.can_access_hospital(v_hospital) THEN
    RAISE EXCEPTION 'hospital_scope_denied';
  END IF;

  PERFORM set_config('statement_timeout', '0', true);

  -- Solta referências que impedem o DELETE (mesmo critério do clear-company-items).
  UPDATE public.doctor_messages SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = p_payment_id AND company_name = p_company_name);

  UPDATE public.reconciliation_items SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = p_payment_id AND company_name = p_company_name);

  UPDATE public.reconciliation_items SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = p_payment_id AND company_name = p_company_name);

  UPDATE public.glosa_items SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = p_payment_id AND company_name = p_company_name);

  UPDATE public.production_validation_feedbacks SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = p_payment_id AND company_name = p_company_name);

  WITH del AS (
    DELETE FROM public.payment_items
     WHERE payment_id = p_payment_id AND company_name = p_company_name
     RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM del;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    WITH ins AS (
      INSERT INTO public.payment_items (
        hospital_id, payment_id, company_name, company_id,
        doctor_name, doctor_document, doctor_email, description,
        gross_amount, attendance_number, procedure_code, procedure_name,
        access_route, doctor_role, agreement_text, specialty,
        procedure_amount, quantity, procedure_date, patient_name,
        sector, attendance_character, raw_data, tipo_linha,
        source_file_name, item_type_id, item_type_source
      )
      SELECT
        v_hospital, p_payment_id, p_company_name, x.company_id,
        x.doctor_name, x.doctor_document, x.doctor_email, x.description,
        x.gross_amount, x.attendance_number, x.procedure_code, x.procedure_name,
        x.access_route, x.doctor_role, x.agreement_text, x.specialty,
        x.procedure_amount, x.quantity, x.procedure_date, x.patient_name,
        x.sector, x.attendance_character, x.raw_data, x.tipo_linha,
        x.source_file_name, x.item_type_id, x.item_type_source
      FROM jsonb_to_recordset(p_items) AS x(
        company_id uuid,
        doctor_name text,
        doctor_document text,
        doctor_email text,
        description text,
        gross_amount numeric,
        attendance_number text,
        procedure_code text,
        procedure_name text,
        access_route text,
        doctor_role text,
        agreement_text text,
        specialty text,
        procedure_amount numeric,
        quantity numeric,
        procedure_date timestamptz,
        patient_name text,
        sector text,
        attendance_character text,
        raw_data jsonb,
        tipo_linha text,
        source_file_name text,
        item_type_id uuid,
        item_type_source text
      )
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  END IF;

  RETURN jsonb_build_object('removed', v_removed, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.reimport_company_items(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reimport_company_items(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reimport_company_items(uuid, text, jsonb) TO authenticated;