CREATE INDEX IF NOT EXISTS idx_payment_items_hospital_competence
  ON public.payment_items (hospital_id, item_competence)
  WHERE item_competence IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_specialty_payments_agg(
  p_hospital uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  competence date,
  payment_id uuid,
  company_id uuid,
  doctor_id uuid,
  gross numeric,
  items bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Mesma checagem de escopo usada no resto do sistema (levanta exceção).
  PERFORM public.assert_hospital_access(p_hospital);

  RETURN QUERY
  SELECT
    date_trunc('month', pi.item_competence)::date AS competence,
    pi.payment_id,
    pi.company_id,
    pi.doctor_id,
    SUM(COALESCE(pi.gross_amount, 0))::numeric AS gross,
    COUNT(*)::bigint AS items
  FROM public.payment_items pi
  WHERE pi.hospital_id = p_hospital
    AND pi.item_competence IS NOT NULL
    AND pi.item_competence >= p_from
    AND pi.item_competence <= p_to
    AND COALESCE(pi.is_cancelled, false) = false
  GROUP BY 1, 2, 3, 4;
END;
$$;

REVOKE ALL ON FUNCTION public.get_specialty_payments_agg(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_specialty_payments_agg(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_specialty_payments_agg(uuid, date, date) TO service_role;