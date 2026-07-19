
CREATE OR REPLACE FUNCTION public.get_batch_composition(
  p_processing_month date DEFAULT NULL::date,
  p_history_months integer DEFAULT 5
)
RETURNS TABLE(
  pattern_name text,
  historical_avg numeric,
  historical_min numeric,
  historical_max numeric,
  months_present integer,
  current_amount numeric,
  current_payment_id uuid,
  current_reference text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid := current_active_hospital();
  v_proc_month date;
  v_history_start date;
BEGIN
  SET LOCAL statement_timeout = '15s';

  v_proc_month := coalesce(p_processing_month, (date_trunc('month', now()) - interval '1 month')::date);
  v_history_start := (v_proc_month - (p_history_months || ' months')::interval)::date;

  RETURN QUERY
  WITH pats AS (
    SELECT id, label, aliases
    FROM payment_batch_patterns
    WHERE hospital_id = v_hospital AND active
  ),
  raw AS (
    SELECT
      p.id AS payment_id,
      p.reference,
      p.competence_month::date AS comp,
      p.bruto_total,
      p.batch_pattern_id,
      lower(unaccent(coalesce(p.reference, ''))) AS ref_norm
    FROM payments p
    WHERE p.hospital_id = v_hospital
      AND p.competence_month >= v_history_start
      AND p.competence_month <= v_proc_month
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND p.bruto_total > 0
  ),
  resolved AS (
    SELECT
      r.payment_id, r.reference, r.comp, r.bruto_total,
      COALESCE(
        -- 1) vínculo manual
        (SELECT p1.label FROM pats p1 WHERE p1.id = r.batch_pattern_id LIMIT 1),
        -- 2) match por alias (containment normalizado)
        (
          SELECT p2.label FROM pats p2
          WHERE EXISTS (
            SELECT 1 FROM unnest(p2.aliases) AS a
            WHERE a IS NOT NULL AND btrim(a) <> ''
              AND r.ref_norm LIKE '%' || lower(unaccent(a)) || '%'
          )
          LIMIT 1
        ),
        -- 3) fallback regex (mesma limpeza anterior)
        NULLIF(
          btrim(regexp_replace(
            regexp_replace(
              regexp_replace(
                coalesce(r.reference, ''),
                '\s*-?\s*(Pagamento\s+)?(Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*/?\s*\d{4}',
                '', 'gi'
              ),
              '^\W*🛠\W*', '', 'g'
            ),
            '[\s-]+$', '', 'g'
          )),
          ''
        )
      ) AS pattern
    FROM raw r
  ),
  history AS (
    SELECT
      pattern,
      count(DISTINCT to_char(comp, 'YYYY-MM'))::integer AS months_present,
      round(avg(bruto_total)::numeric, 2) AS avg_val,
      round(min(bruto_total)::numeric, 2) AS min_val,
      round(max(bruto_total)::numeric, 2) AS max_val
    FROM resolved
    WHERE comp < v_proc_month AND pattern IS NOT NULL
    GROUP BY pattern
    HAVING count(DISTINCT to_char(comp, 'YYYY-MM')) >= 2
  ),
  current_month AS (
    SELECT
      pattern,
      sum(bruto_total)::numeric AS cur_amount,
      (array_agg(payment_id ORDER BY bruto_total DESC))[1] AS cur_pid,
      (array_agg(reference ORDER BY bruto_total DESC))[1] AS cur_ref
    FROM resolved
    WHERE comp = v_proc_month AND pattern IS NOT NULL
    GROUP BY pattern
  )
  SELECT
    h.pattern AS pattern_name,
    h.avg_val AS historical_avg,
    h.min_val AS historical_min,
    h.max_val AS historical_max,
    h.months_present,
    c.cur_amount AS current_amount,
    c.cur_pid AS current_payment_id,
    c.cur_ref AS current_reference,
    CASE WHEN c.cur_amount IS NOT NULL THEN 'recebido' ELSE 'pendente' END AS status
  FROM history h
  LEFT JOIN current_month c ON c.pattern = h.pattern
  ORDER BY h.avg_val DESC;
END;
$function$;
