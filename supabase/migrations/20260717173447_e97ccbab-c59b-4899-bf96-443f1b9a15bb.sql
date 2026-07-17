
CREATE OR REPLACE FUNCTION public.get_simulator_matched_names(
  p_hospital_id uuid,
  p_ano integer,
  p_mode text,
  p_candidates text[]
) RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_active uuid;
  v_from date;
  v_to date;
  v_result text[];
BEGIN
  v_active := public.current_active_hospital();
  IF v_active IS NULL OR v_active <> p_hospital_id THEN
    RAISE EXCEPTION 'hospital_not_active';
  END IF;
  IF p_mode NOT IN ('medico','procedimento') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;
  IF p_candidates IS NULL OR array_length(p_candidates,1) IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  v_from := make_date(p_ano, 1, 1);
  v_to   := make_date(p_ano + 1, 1, 1);

  WITH candidates AS (
    SELECT c AS original,
           trim(regexp_replace(
             regexp_replace(lower(extensions.unaccent(c)),'[^a-z0-9 ]+',' ','g'),
             '\s+',' ','g')) AS norm_c
    FROM unnest(p_candidates) AS c
  ),
  item_norms AS (
    SELECT DISTINCT
      trim(regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(
            CASE WHEN p_mode = 'medico' THEN doctor_name ELSE procedure_name END
          )),
          '[^a-z0-9 ]+', ' ', 'g'),
        '\s+', ' ', 'g')) AS n
    FROM public.payment_items
    WHERE hospital_id = p_hospital_id
      AND procedure_date >= v_from
      AND procedure_date <  v_to
      AND (CASE WHEN p_mode = 'medico' THEN doctor_name ELSE procedure_name END) IS NOT NULL
  ),
  direct_match AS (
    SELECT c.original
    FROM candidates c
    WHERE c.norm_c <> ''
      AND EXISTS (SELECT 1 FROM item_norms i WHERE i.n = c.norm_c)
  ),
  alias_match AS (
    SELECT c.original
    FROM candidates c
    WHERE p_mode = 'procedimento'
      AND EXISTS (
        SELECT 1 FROM public.procedure_aliases pa
        JOIN item_norms i
          ON i.n = trim(regexp_replace(
                     regexp_replace(lower(extensions.unaccent(pa.canonical_name)),
                       '[^a-z0-9 ]+', ' ', 'g'),
                     '\s+', ' ', 'g'))
        WHERE pa.hospital_id = p_hospital_id
          AND pa.alias_normalized = c.norm_c
      )
    UNION
    SELECT c.original
    FROM candidates c
    WHERE p_mode = 'medico'
      AND EXISTS (
        SELECT 1
        FROM public.doctor_aliases da
        JOIN public.doctors d ON d.id = da.doctor_id
        JOIN item_norms i
          ON i.n = trim(regexp_replace(
                     regexp_replace(lower(extensions.unaccent(d.full_name)),
                       '[^a-z0-9 ]+', ' ', 'g'),
                     '\s+', ' ', 'g'))
        WHERE da.alias_normalized = c.norm_c
      )
  )
  SELECT COALESCE(array_agg(DISTINCT original), ARRAY[]::text[])
    INTO v_result
    FROM (
      SELECT original FROM direct_match
      UNION
      SELECT original FROM alias_match
    ) x;

  RETURN COALESCE(v_result, ARRAY[]::text[]);
END;
$$;
