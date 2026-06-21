
-- 1) Flag is_test em payments e payment_company_groups
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_payments_is_test ON public.payments(is_test) WHERE is_test = true;
CREATE INDEX IF NOT EXISTS idx_pcg_is_test ON public.payment_company_groups(is_test) WHERE is_test = true;

-- 2) Backfill: lotes legados da suíte (reference __test_%) + grupos com company_name __test_co_%
UPDATE public.payments
   SET is_test = true
 WHERE reference LIKE '__test_%';

UPDATE public.payment_company_groups
   SET is_test = true
 WHERE payment_id IN (SELECT id FROM public.payments WHERE is_test = true)
    OR company_name LIKE '__test_co_%';

-- 3) Política RESTRITIVA de SELECT (AND com as policies existentes) escondendo is_test=true
--    Não toca em INSERT/UPDATE/DELETE para não quebrar a limpeza dos próprios testes
--    (que rodam via SUPABASE_DB_URL = papel postgres, que bypassa RLS de qualquer jeito).
DROP POLICY IF EXISTS hide_test_rows_select ON public.payments;
CREATE POLICY hide_test_rows_select
  ON public.payments
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (is_test = false);

DROP POLICY IF EXISTS hide_test_rows_select ON public.payment_company_groups;
CREATE POLICY hide_test_rows_select
  ON public.payment_company_groups
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (is_test = false);

-- 4) Helper para a suíte poder limpar rastros antigos sem depender de RLS
CREATE OR REPLACE FUNCTION public.purge_test_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.payments
     WHERE is_test = true
        OR reference LIKE '__test_%'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_test_payments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_test_payments() TO service_role;
