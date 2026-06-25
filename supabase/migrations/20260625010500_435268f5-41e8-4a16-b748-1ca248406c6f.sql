
-- 1) Helper: resolve convenio slug a partir de texto bruto.
--    Mirror dos stems hardcoded (Bradesco/Sul América/Amil/Unimed) +
--    lookup em convenio_aliases + nome canônico em convenios.
CREATE OR REPLACE FUNCTION public.resolve_convenio_slug(_raw text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_slug text;
BEGIN
  v_norm := normalize_alias(_raw);
  IF v_norm IS NULL OR v_norm = '' THEN
    RETURN NULL;
  END IF;

  -- Stems (case-insensitive). Ordem importa: específicos antes do default.
  IF _raw ~* '(brade?s|bradesco).*func'                                                  THEN RETURN 'bradesco_funcional'; END IF;
  IF _raw ~* '(brade?s|bradesco).*(opera?d\M|operadoras?|\Mop\M)'                        THEN RETURN 'bradesco_operad'; END IF;
  IF _raw ~* '(brade?s|bradesco).*(segur|seguros?|saude)'                                THEN RETURN 'bradesco_segur'; END IF;
  IF _raw ~* '^\s*brade?sco\s*$'                                                         THEN RETURN 'bradesco_segur'; END IF;
  IF _raw ~* 'sul[\s\-_./]*america'                                                      THEN RETURN 'sul_america'; END IF;
  IF _raw ~* '^\s*amil(\s|$|saude|\s*-\s*|\s+one)'                                       THEN RETURN 'amil'; END IF;
  IF _raw ~* '(central[\s\-_./]+nacional[\s\-_./]+unimed|unimed[\s\-_./]+central|unimed[\s\-_./]+rede[\s\-_./]*master|^\s*cnu\s*$)' THEN RETURN 'central_nacional_unimed'; END IF;

  -- Alias cadastrado
  SELECT convenio_slug INTO v_slug
    FROM convenio_aliases
   WHERE alias_normalized = v_norm
   LIMIT 1;
  IF v_slug IS NOT NULL THEN RETURN v_slug; END IF;

  -- Nome canônico
  SELECT slug INTO v_slug
    FROM convenios
   WHERE active = true
     AND normalize_alias(name) = v_norm
   LIMIT 1;

  RETURN v_slug;
END;
$$;

-- 2) Pool branch da distribute: passa a popular convenio_slug, sector_slug,
--    doctor_id (lookup estrito) — sem isso, itens promovidos para o pool
--    nascem sem vínculo e quebram cross-reference / motor.
CREATE OR REPLACE FUNCTION public.distribute_unmatched_items_by_doctor(
  _payment_id uuid, _raw_company_name text
)
RETURNS TABLE(linked integer, unresolved integer, companies_used uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked integer := 0;
  v_unresolved integer := 0;
  v_companies uuid[] := ARRAY[]::uuid[];
  v_pool_id uuid;
BEGIN
  IF _payment_id IS NULL OR coalesce(btrim(_raw_company_name), '') = '' THEN
    RAISE EXCEPTION 'parâmetros obrigatórios ausentes';
  END IF;

  SELECT pool_id INTO v_pool_id FROM payments WHERE id = _payment_id;

  CREATE TEMP TABLE _participants ON COMMIT DROP AS
  SELECT DISTINCT pcg.company_id, c.name
    FROM payment_company_groups pcg
    JOIN companies c ON c.id = pcg.company_id
   WHERE pcg.payment_id = _payment_id;

  IF NOT EXISTS (SELECT 1 FROM _participants) THEN
    RAISE EXCEPTION 'pagamento sem participantes de rateio cadastrados';
  END IF;

  IF v_pool_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.payment_items (
        payment_id, doctor_name, doctor_document, doctor_email, description,
        gross_amount, company_name, company_id, attendance_number, procedure_code,
        procedure_name, access_route, doctor_role, agreement_text, specialty,
        procedure_amount, quantity, procedure_date, patient_name, sector,
        raw_data, tipo_linha, convenio_value_totalized,
        convenio_slug, convenio_matched_by,
        sector_slug, sector_matched_by,
        doctor_id, doctor_matched_by
      )
      SELECT
        u.payment_id, u.doctor_name, u.doctor_document, u.doctor_email, u.description,
        u.gross_amount, NULL, NULL, u.attendance_number, u.procedure_code,
        u.procedure_name, u.access_route, u.doctor_role, u.agreement_text, u.specialty,
        u.procedure_amount, u.quantity, u.procedure_date, u.patient_name, u.sector,
        u.raw_data, u.tipo_linha, u.convenio_value_totalized,
        resolve_convenio_slug(u.agreement_text),
        CASE WHEN resolve_convenio_slug(u.agreement_text) IS NOT NULL THEN 'alias' END,
        (SELECT s.slug FROM sectors s WHERE s.active = true AND normalize_alias(s.name) = normalize_alias(u.sector) LIMIT 1),
        CASE WHEN EXISTS (SELECT 1 FROM sectors s WHERE s.active AND normalize_alias(s.name)=normalize_alias(u.sector)) THEN 'name' END,
        COALESCE(
          (SELECT d.id FROM doctors d
            WHERE u.doctor_document IS NOT NULL
              AND regexp_replace(coalesce(d.cpf,''),'\D','','g') = regexp_replace(u.doctor_document,'\D','','g')
              AND regexp_replace(u.doctor_document,'\D','','g') <> '' LIMIT 1),
          (SELECT da.doctor_id FROM doctor_aliases da WHERE da.alias_normalized = normalize_alias(u.doctor_name) LIMIT 1),
          (SELECT d.id FROM doctors d WHERE normalize_alias(d.full_name) = normalize_alias(u.doctor_name) LIMIT 1)
        ),
        CASE WHEN COALESCE(
          (SELECT d.id FROM doctors d
            WHERE u.doctor_document IS NOT NULL
              AND regexp_replace(coalesce(d.cpf,''),'\D','','g') = regexp_replace(u.doctor_document,'\D','','g')
              AND regexp_replace(u.doctor_document,'\D','','g') <> '' LIMIT 1),
          (SELECT da.doctor_id FROM doctor_aliases da WHERE da.alias_normalized = normalize_alias(u.doctor_name) LIMIT 1),
          (SELECT d.id FROM doctors d WHERE normalize_alias(d.full_name) = normalize_alias(u.doctor_name) LIMIT 1)
        ) IS NOT NULL THEN 'name' END
        FROM payment_unmatched_items u
       WHERE u.payment_id = _payment_id
         AND u.raw_company_name = _raw_company_name
         AND u.status = 'pending'
      RETURNING 1
    )
    SELECT count(*)::int INTO v_linked FROM ins;

    UPDATE payment_unmatched_items
       SET status='linked', resolved_at=now(), resolved_by=auth.uid()
     WHERE payment_id=_payment_id AND raw_company_name=_raw_company_name AND status='pending';

    SELECT coalesce(array_agg(company_id), ARRAY[]::uuid[]) INTO v_companies FROM _participants;
    RETURN QUERY SELECT v_linked, 0, v_companies;
    RETURN;
  END IF;

  -- Fluxo padrão (não-pool): inalterado, delega à versão prévia via dynamic SQL.
  -- Mantemos comportamento antigo só para lotes sem pool.
  CREATE TEMP TABLE _resolved ON COMMIT DROP AS
  SELECT u.id AS unmatched_id,
    COALESCE(
      (SELECT d.id FROM doctors d
        WHERE u.doctor_document IS NOT NULL
          AND regexp_replace(coalesce(d.cpf,''),'\D','','g') = regexp_replace(u.doctor_document,'\D','','g')
          AND regexp_replace(u.doctor_document,'\D','','g') <> '' LIMIT 1),
      (SELECT da.doctor_id FROM doctor_aliases da WHERE da.alias_normalized = normalize_alias(u.doctor_name) LIMIT 1),
      (SELECT d.id FROM doctors d WHERE normalize_alias(d.full_name) = normalize_alias(u.doctor_name) LIMIT 1)
    ) AS doctor_id
    FROM payment_unmatched_items u
   WHERE u.payment_id=_payment_id AND u.raw_company_name=_raw_company_name AND u.status='pending';

  WITH picked AS (
    SELECT r.unmatched_id, dc.company_id
      FROM _resolved r
      JOIN doctor_companies dc ON dc.doctor_id = r.doctor_id
      JOIN _participants p ON p.company_id = dc.company_id
  ),
  ins AS (
    INSERT INTO payment_items (
      payment_id, doctor_name, doctor_document, doctor_email, description,
      gross_amount, company_name, company_id, attendance_number, procedure_code,
      procedure_name, access_route, doctor_role, agreement_text, specialty,
      procedure_amount, quantity, procedure_date, patient_name, sector,
      raw_data, tipo_linha, convenio_value_totalized,
      convenio_slug, convenio_matched_by,
      sector_slug, sector_matched_by,
      doctor_id, doctor_matched_by
    )
    SELECT u.payment_id, u.doctor_name, u.doctor_document, u.doctor_email, u.description,
           u.gross_amount, c.name, p.company_id, u.attendance_number, u.procedure_code,
           u.procedure_name, u.access_route, u.doctor_role, u.agreement_text, u.specialty,
           u.procedure_amount, u.quantity, u.procedure_date, u.patient_name, u.sector,
           u.raw_data, u.tipo_linha, u.convenio_value_totalized,
           resolve_convenio_slug(u.agreement_text),
           CASE WHEN resolve_convenio_slug(u.agreement_text) IS NOT NULL THEN 'alias' END,
           (SELECT s.slug FROM sectors s WHERE s.active AND normalize_alias(s.name)=normalize_alias(u.sector) LIMIT 1),
           CASE WHEN EXISTS (SELECT 1 FROM sectors s WHERE s.active AND normalize_alias(s.name)=normalize_alias(u.sector)) THEN 'name' END,
           r.doctor_id,
           CASE WHEN r.doctor_id IS NOT NULL THEN 'name' END
      FROM picked p
      JOIN payment_unmatched_items u ON u.id = p.unmatched_id
      JOIN companies c ON c.id = p.company_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_linked FROM ins;

  UPDATE payment_unmatched_items
     SET status='linked', resolved_at=now(), resolved_by=auth.uid()
   WHERE id IN (SELECT unmatched_id FROM _resolved WHERE doctor_id IS NOT NULL);

  SELECT count(*)::int INTO v_unresolved FROM _resolved WHERE doctor_id IS NULL;
  SELECT coalesce(array_agg(DISTINCT company_id), ARRAY[]::uuid[]) INTO v_companies FROM _participants;
  RETURN QUERY SELECT v_linked, v_unresolved, v_companies;
END;
$$;

-- 3) Backfill retroativo: payment_items sem convenio_slug onde agreement_text
--    é resolvível via stems/alias/nome. Roda para todos os lotes (não só o atual)
--    para corrigir o passivo deixado por importações anteriores.
UPDATE payment_items
   SET convenio_slug = resolve_convenio_slug(agreement_text),
       convenio_matched_by = COALESCE(convenio_matched_by, 'alias')
 WHERE convenio_slug IS NULL
   AND agreement_text IS NOT NULL
   AND resolve_convenio_slug(agreement_text) IS NOT NULL;

-- Backfill sector_slug
UPDATE payment_items pi
   SET sector_slug = s.slug,
       sector_matched_by = COALESCE(pi.sector_matched_by, 'name')
  FROM sectors s
 WHERE pi.sector_slug IS NULL
   AND pi.sector IS NOT NULL
   AND s.active = true
   AND normalize_alias(s.name) = normalize_alias(pi.sector);

-- Backfill doctor_id por nome/cpf
UPDATE payment_items pi
   SET doctor_id = sub.doctor_id,
       doctor_matched_by = COALESCE(pi.doctor_matched_by, 'name')
  FROM (
    SELECT pi2.id,
      COALESCE(
        (SELECT d.id FROM doctors d
          WHERE pi2.doctor_document IS NOT NULL
            AND regexp_replace(coalesce(d.cpf,''),'\D','','g') = regexp_replace(pi2.doctor_document,'\D','','g')
            AND regexp_replace(pi2.doctor_document,'\D','','g') <> '' LIMIT 1),
        (SELECT da.doctor_id FROM doctor_aliases da WHERE da.alias_normalized = normalize_alias(pi2.doctor_name) LIMIT 1),
        (SELECT d.id FROM doctors d WHERE normalize_alias(d.full_name) = normalize_alias(pi2.doctor_name) LIMIT 1)
      ) AS doctor_id
      FROM payment_items pi2
     WHERE pi2.doctor_id IS NULL
       AND pi2.doctor_name IS NOT NULL
  ) sub
 WHERE pi.id = sub.id AND sub.doctor_id IS NOT NULL;
