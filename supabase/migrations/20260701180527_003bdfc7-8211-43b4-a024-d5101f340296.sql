REVOKE ALL ON FUNCTION public.dashboard_pending_company_groups(uuid, public.payment_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_invoice_counts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_company_invoice_questions(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dashboard_pending_company_groups(uuid, public.payment_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_pending_company_groups(uuid, public.payment_status) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_invoice_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_invoice_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_company_invoice_questions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_company_invoice_questions(uuid) TO service_role;