CREATE OR REPLACE FUNCTION public.can_manage_new_payment(_payment_id uuid, _actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = _payment_id
      AND (
        p.created_by = _actor_id
        OR public.has_role(_actor_id, 'admin'::public.app_role)
        OR public.has_role(_actor_id, 'diretor'::public.app_role)
        OR public.has_role(_actor_id, 'analista'::public.app_role)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.rollback_new_payment(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_deleted_items integer := 0;
  v_deleted_unmatched integer := 0;
  v_deleted_groups integer := 0;
  v_deleted_payment integer := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF NOT public.can_manage_new_payment(_payment_id, v_actor) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer este lote';
  END IF;

  DELETE FROM public.payment_unmatched_items WHERE payment_id = _payment_id;
  GET DIAGNOSTICS v_deleted_unmatched = ROW_COUNT;

  DELETE FROM public.payment_items WHERE payment_id = _payment_id;
  GET DIAGNOSTICS v_deleted_items = ROW_COUNT;

  DELETE FROM public.payment_company_groups WHERE payment_id = _payment_id;
  GET DIAGNOSTICS v_deleted_groups = ROW_COUNT;

  DELETE FROM public.payments WHERE id = _payment_id;
  GET DIAGNOSTICS v_deleted_payment = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_payment', v_deleted_payment,
    'deleted_items', v_deleted_items,
    'deleted_unmatched', v_deleted_unmatched,
    'deleted_groups', v_deleted_groups
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_new_payment_items(_payment_id uuid, _items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inserted integer := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF NOT public.can_manage_new_payment(_payment_id, v_actor) THEN
    RAISE EXCEPTION 'Sem permissão para salvar itens neste lote';
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload de itens inválido';
  END IF;

  INSERT INTO public.payment_items (
    hospital_id,
    payment_id,
    doctor_name,
    doctor_document,
    doctor_email,
    description,
    gross_amount,
    company_name,
    company_id,
    attendance_number,
    procedure_code,
    procedure_name,
    access_route,
    doctor_role,
    agreement_text,
    specialty,
    procedure_amount,
    quantity,
    procedure_date,
    procedure_date_has_time,
    patient_name,
    sector,
    attendance_character,
    raw_data,
    tipo_linha,
    convenio_value_totalized,
    doctor_id,
    doctor_matched_by,
    convenio_slug,
    convenio_matched_by,
    sector_slug,
    sector_matched_by,
    item_type_id,
    item_type_source
  )
  SELECT
    x.hospital_id,
    _payment_id,
    x.doctor_name,
    x.doctor_document,
    x.doctor_email,
    x.description,
    x.gross_amount,
    x.company_name,
    x.company_id,
    x.attendance_number,
    x.procedure_code,
    x.procedure_name,
    x.access_route,
    x.doctor_role,
    x.agreement_text,
    x.specialty,
    x.procedure_amount,
    COALESCE(x.quantity, 1),
    x.procedure_date,
    COALESCE(x.procedure_date_has_time, false),
    x.patient_name,
    x.sector,
    x.attendance_character,
    x.raw_data,
    x.tipo_linha,
    COALESCE(x.convenio_value_totalized, false),
    x.doctor_id,
    x.doctor_matched_by,
    x.convenio_slug,
    x.convenio_matched_by,
    x.sector_slug,
    x.sector_matched_by,
    x.item_type_id,
    x.item_type_source
  FROM jsonb_to_recordset(COALESCE(_items, '[]'::jsonb)) AS x(
    hospital_id uuid,
    doctor_name text,
    doctor_document text,
    doctor_email text,
    description text,
    gross_amount numeric,
    company_name text,
    company_id uuid,
    attendance_number text,
    procedure_code text,
    procedure_name text,
    access_route text,
    doctor_role text,
    agreement_text text,
    specialty text,
    procedure_amount numeric,
    quantity integer,
    procedure_date date,
    procedure_date_has_time boolean,
    patient_name text,
    sector text,
    attendance_character text,
    raw_data jsonb,
    tipo_linha text,
    convenio_value_totalized boolean,
    doctor_id uuid,
    doctor_matched_by text,
    convenio_slug text,
    convenio_matched_by text,
    sector_slug text,
    sector_matched_by text,
    item_type_id uuid,
    item_type_source text
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_new_payment_unmatched_items(_payment_id uuid, _items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inserted integer := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF NOT public.can_manage_new_payment(_payment_id, v_actor) THEN
    RAISE EXCEPTION 'Sem permissão para salvar itens em quarentena neste lote';
  END IF;

  IF jsonb_typeof(COALESCE(_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload de itens em quarentena inválido';
  END IF;

  INSERT INTO public.payment_unmatched_items (
    payment_id,
    source_file,
    raw_company_name,
    match_score,
    match_suggestion_id,
    match_suggestion_name,
    hospital_id,
    doctor_name,
    doctor_document,
    doctor_email,
    description,
    gross_amount,
    attendance_number,
    procedure_code,
    procedure_name,
    access_route,
    doctor_role,
    agreement_text,
    specialty,
    procedure_amount,
    quantity,
    procedure_date,
    procedure_date_has_time,
    patient_name,
    sector,
    attendance_character,
    raw_data,
    tipo_linha,
    convenio_value_totalized
  )
  SELECT
    _payment_id,
    x.source_file,
    x.raw_company_name,
    COALESCE(x.match_score, 0),
    x.match_suggestion_id,
    x.match_suggestion_name,
    x.hospital_id,
    x.doctor_name,
    x.doctor_document,
    x.doctor_email,
    x.description,
    x.gross_amount,
    x.attendance_number,
    x.procedure_code,
    x.procedure_name,
    x.access_route,
    x.doctor_role,
    x.agreement_text,
    x.specialty,
    x.procedure_amount,
    COALESCE(x.quantity, 1),
    x.procedure_date,
    COALESCE(x.procedure_date_has_time, false),
    x.patient_name,
    x.sector,
    x.attendance_character,
    x.raw_data,
    x.tipo_linha,
    COALESCE(x.convenio_value_totalized, false)
  FROM jsonb_to_recordset(COALESCE(_items, '[]'::jsonb)) AS x(
    source_file text,
    raw_company_name text,
    match_score numeric,
    match_suggestion_id uuid,
    match_suggestion_name text,
    hospital_id uuid,
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
    quantity integer,
    procedure_date date,
    procedure_date_has_time boolean,
    patient_name text,
    sector text,
    attendance_character text,
    raw_data jsonb,
    tipo_linha text,
    convenio_value_totalized boolean
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_new_payment(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rollback_new_payment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_new_payment_items(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_new_payment_unmatched_items(uuid, jsonb) TO authenticated, service_role;