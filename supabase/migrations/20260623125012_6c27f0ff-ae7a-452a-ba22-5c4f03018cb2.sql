CREATE OR REPLACE FUNCTION public.delete_parecer_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Eleva o timeout só nesta transação (delete de milhares de linhas
  -- estourava o limite default do PostgREST/edge).
  PERFORM set_config('statement_timeout', '120000', true);

  DELETE FROM public.payment_parecer_report_rows WHERE report_id = p_report_id;
  DELETE FROM public.payment_parecer_reports     WHERE id = p_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_parecer_report(uuid) TO service_role;