
CREATE OR REPLACE FUNCTION public.get_doctors_missing_specialty()
RETURNS TABLE (
  doctor_name_raw text,
  doctor_name_norm text,
  total_gross numeric,
  n_items bigint,
  matched_doctor_id uuid,
  matched_doctor_name text,
  current_specialties text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      btrim(pi.doctor_name) AS raw,
      lower(btrim(pi.doctor_name)) AS norm,
      pi.gross_amount,
      pi.specialty
    FROM public.payment_items pi
    WHERE pi.doctor_name IS NOT NULL
      AND btrim(pi.doctor_name) <> ''
  ),
  resolved AS (
    SELECT
      b.raw,
      b.norm,
      b.gross_amount,
      COALESCE(
        nullif(btrim(b.specialty), ''),
        (SELECT (d.specialties)[1] FROM public.doctors d
          WHERE lower(btrim(d.full_name)) = b.norm
          LIMIT 1)
      ) AS especialidade
    FROM base b
  ),
  agg AS (
    SELECT
      raw,
      norm,
      SUM(COALESCE(gross_amount,0)) AS total_gross,
      COUNT(*) AS n_items
    FROM resolved
    WHERE especialidade IS NULL
    GROUP BY raw, norm
  )
  SELECT
    a.raw AS doctor_name_raw,
    a.norm AS doctor_name_norm,
    a.total_gross,
    a.n_items,
    d.id AS matched_doctor_id,
    d.full_name AS matched_doctor_name,
    COALESCE(d.specialties, ARRAY[]::text[]) AS current_specialties
  FROM agg a
  LEFT JOIN LATERAL (
    SELECT d.id, d.full_name, d.specialties
    FROM public.doctors d
    WHERE lower(btrim(d.full_name)) = a.norm
    LIMIT 1
  ) d ON true
  ORDER BY a.total_gross DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctors_missing_specialty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctors_missing_specialty() TO service_role;
