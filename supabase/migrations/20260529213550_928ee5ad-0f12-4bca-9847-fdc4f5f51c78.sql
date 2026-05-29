-- Grants Data-API para o portal da empresa conseguir ler/escrever validações
GRANT SELECT, UPDATE ON public.production_validations TO authenticated;
GRANT ALL ON public.production_validations TO service_role;

GRANT SELECT, INSERT ON public.production_validation_feedbacks TO authenticated;
GRANT ALL ON public.production_validation_feedbacks TO service_role;

GRANT SELECT ON public.company_portal_users TO authenticated;
GRANT ALL ON public.company_portal_users TO service_role;