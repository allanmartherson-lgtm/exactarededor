
CREATE OR REPLACE FUNCTION public.suggest_batch_patterns(
  p_history_months integer DEFAULT 6
)
RETURNS TABLE(
  suggested_label text,
  months_seen integer,
  avg_bruto numeric,
  distinct_references text[],
  payment_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid := current_active_hospital();
  v_start date := (date_trunc('month', now()) - (p_history_months || ' months')::interval)::date;
BEGIN
  SET LOCAL statement_timeout = '15s';

  RETURN QUERY
  WITH raw AS (
    SELECT
      p.id, p.reference, p.competence_month::date AS comp, p.bruto_total,
      lower(unaccent(coalesce(p.reference, ''))) AS ref_norm,
      btrim(regexp_replace(
        regexp_replace(
          regexp_replace(
            coalesce(p.reference, ''),
            '\s*-?\s*(Pagamento\s+)?(Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*/?\s*\d{4}',
            '', 'gi'
          ),
          '^\W*🛠\W*', '', 'g'
        ),
        '[\s-]+$', '', 'g'
      )) AS signature
    FROM payments p
    WHERE p.hospital_id = v_hospital
      AND p.competence_month >= v_start
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND p.bruto_total > 0
      AND p.batch_pattern_id IS NULL
  ),
  existing_aliases AS (
    SELECT lower(unaccent(a)) AS a_norm
    FROM payment_batch_patterns pbp,
         LATERAL unnest(pbp.aliases) AS a
    WHERE pbp.hospital_id = v_hospital AND pbp.active
  ),
  grouped AS (
    SELECT
      signature,
      count(DISTINCT to_char(comp, 'YYYY-MM'))::integer AS months_seen,
      round(avg(bruto_total)::numeric, 2) AS avg_bruto,
      array_agg(DISTINCT reference) AS distinct_refs,
      array_agg(id) AS pids
    FROM raw
    WHERE signature <> ''
      AND NOT EXISTS (
        SELECT 1 FROM existing_aliases ea
        WHERE raw.ref_norm LIKE '%' || ea.a_norm || '%'
      )
    GROUP BY signature
    HAVING count(DISTINCT to_char(comp, 'YYYY-MM')) >= 2
  )
  SELECT
    signature AS suggested_label,
    months_seen,
    avg_bruto,
    distinct_refs AS distinct_references,
    pids AS payment_ids
  FROM grouped
  ORDER BY avg_bruto DESC NULLS LAST;
END;
$function$;
