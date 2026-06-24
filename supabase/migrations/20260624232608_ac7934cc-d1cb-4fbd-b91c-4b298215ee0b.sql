
CREATE OR REPLACE FUNCTION public.distribute_unmatched_items_by_doctor(_payment_id uuid, _raw_company_name text)
 RETURNS TABLE(linked integer, unresolved integer, companies_used uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_linked integer := 0;
  v_unresolved integer := 0;
  v_companies uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _payment_id IS NULL OR coalesce(btrim(_raw_company_name), '') = '' THEN
    RAISE EXCEPTION 'parâmetros obrigatórios ausentes';
  END IF;

  CREATE TEMP TABLE _participants ON COMMIT DROP AS
  SELECT DISTINCT pcg.company_id, c.name
    FROM payment_company_groups pcg
    JOIN companies c ON c.id = pcg.company_id
   WHERE pcg.payment_id = _payment_id;

  IF NOT EXISTS (SELECT 1 FROM _participants) THEN
    RAISE EXCEPTION 'pagamento sem participantes de rateio cadastrados';
  END IF;

  CREATE TEMP TABLE _resolved ON COMMIT DROP AS
  SELECT
    u.id AS unmatched_id,
    COALESCE(
      (SELECT d.id FROM doctors d
        WHERE u.doctor_document IS NOT NULL
          AND regexp_replace(coalesce(d.cpf,''), '\D', '', 'g')
              = regexp_replace(u.doctor_document, '\D', '', 'g')
          AND regexp_replace(u.doctor_document, '\D', '', 'g') <> ''
        LIMIT 1),
      (SELECT da.doctor_id FROM doctor_aliases da
        WHERE da.alias_normalized = normalize_alias(u.doctor_name)
        LIMIT 1),
      (SELECT d.id FROM doctors d
        WHERE normalize_alias(d.full_name) = normalize_alias(u.doctor_name)
        LIMIT 1)
    ) AS doctor_id
    FROM payment_unmatched_items u
   WHERE u.payment_id = _payment_id
     AND u.raw_company_name = _raw_company_name
     AND u.status = 'pending';

  CREATE TEMP TABLE _mapped ON COMMIT DROP AS
  SELECT r.unmatched_id,
         (
           SELECT dc.company_id
             FROM doctor_companies dc
             JOIN _participants p ON p.company_id = dc.company_id
            WHERE dc.doctor_id = r.doctor_id
            ORDER BY (dc.end_date IS NULL) DESC, dc.start_date DESC NULLS LAST
            LIMIT 1
         ) AS company_id
    FROM _resolved r;

  WITH ins AS (
    INSERT INTO public.payment_items (
      payment_id, doctor_name, doctor_document, doctor_email, description,
      gross_amount, company_name, company_id, attendance_number, procedure_code,
      procedure_name, access_route, doctor_role, agreement_text, specialty,
      procedure_amount, quantity, procedure_date, patient_name, sector,
      raw_data, tipo_linha, convenio_value_totalized
    )
    SELECT
      u.payment_id, u.doctor_name, u.doctor_document, u.doctor_email, u.description,
      u.gross_amount, c.name, m.company_id, u.attendance_number, u.procedure_code,
      u.procedure_name, u.access_route, u.doctor_role, u.agreement_text, u.specialty,
      u.procedure_amount, u.quantity, u.procedure_date, u.patient_name, u.sector,
      u.raw_data, u.tipo_linha, u.convenio_value_totalized
      FROM _mapped m
      JOIN payment_unmatched_items u ON u.id = m.unmatched_id
      JOIN companies c ON c.id = m.company_id
     WHERE m.company_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::int INTO v_linked FROM ins;

  UPDATE payment_unmatched_items u
     SET status = 'linked',
         resolved_at = now(),
         resolved_by = auth.uid()
   FROM _mapped m
   WHERE u.id = m.unmatched_id
     AND m.company_id IS NOT NULL;

  SELECT count(*)::int INTO v_unresolved
    FROM _mapped m WHERE m.company_id IS NULL;

  SELECT coalesce(array_agg(DISTINCT m.company_id) FILTER (WHERE m.company_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_companies FROM _mapped m;

  RETURN QUERY SELECT v_linked, v_unresolved, v_companies;
END;
$function$;
