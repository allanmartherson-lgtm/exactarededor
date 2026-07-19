CREATE OR REPLACE FUNCTION public.get_batch_composition(p_processing_month date DEFAULT NULL::date, p_history_months integer DEFAULT 5)
 RETURNS TABLE(pattern_name text, historical_avg numeric, historical_min numeric, historical_max numeric, months_present integer, current_amount numeric, current_payment_id uuid, current_reference text, status text)
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
  WITH normalized AS (
    SELECT
      p.id as payment_id,
      p.reference,
      p.competence_month::date as comp,
      p.bruto_total,
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
      )) as pattern
    FROM payments p
    WHERE p.hospital_id = v_hospital
      AND p.competence_month >= v_history_start
      AND p.competence_month <= v_proc_month
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND p.bruto_total > 0
  ),
  history AS (
    SELECT
      pattern,
      count(DISTINCT to_char(comp, 'YYYY-MM'))::integer as months_present,
      round(avg(bruto_total)::numeric, 2) as avg_val,
      round(min(bruto_total)::numeric, 2) as min_val,
      round(max(bruto_total)::numeric, 2) as max_val
    FROM normalized
    WHERE comp < v_proc_month
      AND pattern != ''
    GROUP BY pattern
    HAVING count(DISTINCT to_char(comp, 'YYYY-MM')) >= 2
  ),
  current_month AS (
    SELECT
      pattern,
      sum(bruto_total)::numeric as cur_amount,
      (array_agg(payment_id ORDER BY bruto_total DESC))[1] as cur_pid,
      (array_agg(reference ORDER BY bruto_total DESC))[1] as cur_ref
    FROM normalized
    WHERE comp = v_proc_month
      AND pattern != ''
    GROUP BY pattern
  )
  SELECT
    h.pattern as pattern_name,
    h.avg_val as historical_avg,
    h.min_val as historical_min,
    h.max_val as historical_max,
    h.months_present,
    c.cur_amount as current_amount,
    c.cur_pid as current_payment_id,
    c.cur_ref as current_reference,
    CASE WHEN c.cur_amount IS NOT NULL THEN 'recebido' ELSE 'pendente' END as status
  FROM history h
  LEFT JOIN current_month c ON c.pattern = h.pattern
  ORDER BY h.avg_val DESC;
END;
$function$;