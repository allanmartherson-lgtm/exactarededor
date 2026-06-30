-- user_roles: SELECT para authenticated (policies já filtram por user_id / admin).
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- profiles: leitura+escrita para authenticated (policies já restringem).
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;