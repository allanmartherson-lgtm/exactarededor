DO $$
DECLARE cols text;
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

REVOKE SELECT (upload_token) ON public.invoices FROM authenticated;
REVOKE SELECT (upload_token) ON public.invoices FROM anon;
GRANT SELECT (upload_token) ON public.invoices TO service_role;