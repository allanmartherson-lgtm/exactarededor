
-- Fix 1: invoices.upload_token leak to company portal users
-- Restrict SELECT to non-sensitive columns at the column-privilege level
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'invoices'
    AND column_name <> 'upload_token';

  EXECUTE 'REVOKE SELECT ON public.invoices FROM authenticated';
  EXECUTE 'REVOKE SELECT ON public.invoices FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON public.invoices TO authenticated', cols);
END $$;

-- SECURITY DEFINER helper so hospital staff can still fetch upload tokens
-- (used to render the unique upload link inside the hospital UI)
CREATE OR REPLACE FUNCTION public.get_invoice_upload_tokens(p_invoice_ids uuid[])
RETURNS TABLE (invoice_id uuid, upload_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.upload_token
  FROM public.invoices i
  WHERE i.id = ANY(p_invoice_ids)
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid()
        AND uh.hospital_id = i.hospital_id
    );
$$;

REVOKE ALL ON FUNCTION public.get_invoice_upload_tokens(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invoice_upload_tokens(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_upload_tokens(uuid[]) TO service_role;

-- Fix 2: production_validations.token leak to company portal users
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'production_validations'
    AND column_name <> 'token';

  EXECUTE 'REVOKE SELECT ON public.production_validations FROM authenticated';
  EXECUTE 'REVOKE SELECT ON public.production_validations FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON public.production_validations TO authenticated', cols);
END $$;

-- Fix 3: storage INSERT on payment-email-approvals must verify path's hospital prefix
DROP POLICY IF EXISTS "Hospital members can upload email approval files" ON storage.objects;

CREATE POLICY "Hospital members can upload email approval files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-email-approvals'
  AND EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid()
      AND uh.hospital_id::text = split_part(name, '/', 1)
  )
);
