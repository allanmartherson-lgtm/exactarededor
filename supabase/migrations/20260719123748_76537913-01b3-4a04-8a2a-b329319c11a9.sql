
-- A) Assinatura de regras por hospital (para bust automático do cache do motor)
CREATE OR REPLACE FUNCTION public.get_rules_signature(_hospital_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(
    coalesce(
      (SELECT max(updated_at)::text FROM public.rules WHERE hospital_id = _hospital_id AND active = true),
      ''
    )
    || '|' ||
    coalesce(
      (SELECT count(*)::text FROM public.rules WHERE hospital_id = _hospital_id AND active = true),
      '0'
    )
    || '|' ||
    coalesce(
      (SELECT max(updated_at)::text FROM public.rule_calculations WHERE hospital_id = _hospital_id),
      ''
    )
    || '|' ||
    coalesce(
      (SELECT count(*)::text FROM public.rule_calculations WHERE hospital_id = _hospital_id),
      '0'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_rules_signature(uuid) TO authenticated, service_role;

-- B) Invalidação explícita do cache de contexto de regras ao salvar/editar/excluir regra
CREATE OR REPLACE FUNCTION public.invalidate_rule_context(_hospital_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer := 0;
BEGIN
  IF _hospital_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Só admin/diretor podem invalidar o cache do hospital inteiro; service_role passa direto.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor')) THEN
      RAISE EXCEPTION 'invalidate_rule_context requer admin ou diretor';
    END IF;
    -- E só sobre um hospital que o usuário acessa.
    IF NOT EXISTS (
      SELECT 1 FROM public.user_hospitals
      WHERE user_id = auth.uid() AND hospital_id = _hospital_id
    ) THEN
      RAISE EXCEPTION 'sem acesso ao hospital %', _hospital_id;
    END IF;
  END IF;

  DELETE FROM public.payment_job_context
  WHERE hospital_id = _hospital_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  RETURN _deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invalidate_rule_context(uuid) TO authenticated, service_role;
