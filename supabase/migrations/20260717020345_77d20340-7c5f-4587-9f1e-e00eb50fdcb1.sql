GRANT SELECT, INSERT, UPDATE, DELETE ON public.aurum_margem_medico TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aurum_margem_procedimento TO authenticated;
GRANT ALL ON public.aurum_margem_medico TO service_role;
GRANT ALL ON public.aurum_margem_procedimento TO service_role;