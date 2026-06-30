GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_validations TO authenticated;
GRANT ALL ON public.production_validations TO service_role;