REVOKE ALL ON FUNCTION public.delete_company_financial_adjustment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_company_financial_adjustment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_financial_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_financial_adjustment(uuid, text) TO service_role;