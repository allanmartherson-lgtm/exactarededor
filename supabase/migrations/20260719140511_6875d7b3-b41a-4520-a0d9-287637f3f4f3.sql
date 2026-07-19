
CREATE OR REPLACE FUNCTION public.get_risk_summary(p_months_back integer DEFAULT 6, p_only_active boolean DEFAULT true)
 RETURNS TABLE(tipo text, qtd bigint, valor_risco numeric, lotes_afetados bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid := current_active_hospital();
  v_cutoff date := (date_trunc('month', now()) - (p_months_back || ' months')::interval)::date;
BEGIN
  SET LOCAL statement_timeout = '15s';

  RETURN QUERY
  SELECT
    'Motor de regras (IA)'::text as tipo,
    count(*)::bigint as qtd,
    coalesce(sum(pi.gross_amount), 0)::numeric as valor_risco,
    count(DISTINCT pi.payment_id)::bigint as lotes_afetados
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE p.hospital_id = v_hospital
    AND p.competence_month >= v_cutoff
    AND p.status NOT IN ('rascunho','cancelado','rejeitado')
    AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
    AND pi.ai_status = 'alerta'

  UNION ALL

  SELECT
    'Divergência de valor > 10%'::text,
    count(*)::bigint,
    coalesce(sum(abs(pi.gross_amount - pi.expected_amount)), 0)::numeric,
    count(DISTINCT pi.payment_id)::bigint
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE p.hospital_id = v_hospital
    AND p.competence_month >= v_cutoff
    AND p.status NOT IN ('rascunho','cancelado','rejeitado')
    AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
    AND pi.expected_amount IS NOT NULL
    AND pi.expected_amount > 0
    AND abs(pi.gross_amount - pi.expected_amount) / pi.expected_amount > 0.1

  UNION ALL

  SELECT
    'Validações manuais'::text,
    count(*)::bigint,
    coalesce(sum(pi.gross_amount), 0)::numeric,
    count(DISTINCT pi.payment_id)::bigint
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE p.hospital_id = v_hospital
    AND p.competence_month >= v_cutoff
    AND p.status NOT IN ('rascunho','cancelado','rejeitado')
    AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
    AND pi.validation_findings IS NOT NULL
    AND pi.validation_findings::text NOT IN ('[]','null','{}');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_risk_details(p_tipo text, p_limit integer DEFAULT 30, p_only_active boolean DEFAULT true)
 RETURNS TABLE(payment_id uuid, reference text, company_name text, doctor_name text, specialty text, procedure_code text, gross_amount numeric, expected_amount numeric, divergencia_pct numeric, competencia date, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid := current_active_hospital();
  v_cutoff date := (date_trunc('month', now()) - '6 months'::interval)::date;
BEGIN
  SET LOCAL statement_timeout = '15s';

  IF p_tipo = 'Motor de regras (IA)' THEN
    RETURN QUERY
    SELECT pi.payment_id, p.reference, pi.company_name, pi.doctor_name, pi.specialty,
      pi.procedure_code, pi.gross_amount::numeric, pi.expected_amount::numeric,
      CASE WHEN pi.expected_amount > 0 THEN round(((pi.gross_amount - pi.expected_amount) / pi.expected_amount * 100)::numeric, 1) ELSE 0 END,
      p.competence_month::date, p.status::text
    FROM payment_items pi
    JOIN payments p ON p.id = pi.payment_id
    WHERE p.hospital_id = v_hospital AND p.competence_month >= v_cutoff
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
      AND pi.ai_status = 'alerta'
    ORDER BY pi.gross_amount DESC NULLS LAST LIMIT p_limit;

  ELSIF p_tipo = 'Divergência de valor > 10%' THEN
    RETURN QUERY
    SELECT pi.payment_id, p.reference, pi.company_name, pi.doctor_name, pi.specialty,
      pi.procedure_code, pi.gross_amount::numeric, pi.expected_amount::numeric,
      round(((pi.gross_amount - pi.expected_amount) / pi.expected_amount * 100)::numeric, 1),
      p.competence_month::date, p.status::text
    FROM payment_items pi
    JOIN payments p ON p.id = pi.payment_id
    WHERE p.hospital_id = v_hospital AND p.competence_month >= v_cutoff
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
      AND pi.expected_amount IS NOT NULL AND pi.expected_amount > 0
      AND abs(pi.gross_amount - pi.expected_amount) / pi.expected_amount > 0.1
    ORDER BY abs(pi.gross_amount - pi.expected_amount) DESC NULLS LAST LIMIT p_limit;

  ELSE
    RETURN QUERY
    SELECT pi.payment_id, p.reference, pi.company_name, pi.doctor_name, pi.specialty,
      pi.procedure_code, pi.gross_amount::numeric, pi.expected_amount::numeric,
      CASE WHEN pi.expected_amount > 0 THEN round(((pi.gross_amount - pi.expected_amount) / pi.expected_amount * 100)::numeric, 1) ELSE 0 END,
      p.competence_month::date, p.status::text
    FROM payment_items pi
    JOIN payments p ON p.id = pi.payment_id
    WHERE p.hospital_id = v_hospital AND p.competence_month >= v_cutoff
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
      AND (NOT p_only_active OR p.status NOT IN ('pago','arquivado'))
      AND pi.validation_findings IS NOT NULL AND pi.validation_findings::text NOT IN ('[]','null','{}')
    ORDER BY pi.gross_amount DESC NULLS LAST LIMIT p_limit;
  END IF;
END;
$function$;
