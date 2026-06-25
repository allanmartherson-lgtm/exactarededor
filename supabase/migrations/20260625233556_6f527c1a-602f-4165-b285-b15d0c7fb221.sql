CREATE OR REPLACE FUNCTION public.list_decision_makers(p_role public.app_role)
RETURNS TABLE(id uuid, full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role NOT IN ('diretor'::public.app_role, 'validador'::public.app_role) THEN
    RAISE EXCEPTION 'Papel não suportado: %', p_role;
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'analista'::public.app_role)
    OR public.has_role(auth.uid(), 'validador'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para listar decisores.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id, p.full_name
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = p_role
    AND COALESCE(p.active, true) = true
    AND COALESCE(btrim(p.full_name), '') <> ''
  ORDER BY p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_decision_makers(public.app_role) TO authenticated;