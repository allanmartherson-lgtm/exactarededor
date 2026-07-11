CREATE OR REPLACE FUNCTION public.delete_company_financial_adjustment(
  _adjustment_id uuid,
  _reason text DEFAULT 'Exclusão manual pela tela de Créditos e Débitos'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _adj public.company_financial_adjustments%ROWTYPE;
  _apps jsonb := '[]'::jsonb;
  _app_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'analista'::public.app_role)
    OR public.has_role(auth.uid(), 'validador'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissão para excluir ajuste financeiro' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT *
    INTO _adj
  FROM public.company_financial_adjustments
  WHERE id = _adjustment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  IF _adj.hospital_id IS NOT NULL AND NOT public.hospital_scope_allows(_adj.hospital_id) THEN
    RAISE EXCEPTION 'Ajuste fora do hospital ativo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(caa) ORDER BY caa.applied_at DESC), '[]'::jsonb), count(*)
    INTO _apps, _app_count
  FROM public.company_adjustment_applications caa
  WHERE caa.adjustment_id = _adjustment_id;

  INSERT INTO public.audit_log (
    entity_type,
    entity_id,
    action,
    actor_id,
    company_id,
    hospital_id,
    diff,
    created_at
  ) VALUES (
    'company',
    _adj.company_id,
    'delete',
    auth.uid(),
    _adj.company_id,
    _adj.hospital_id,
    jsonb_build_object(
      'entity', 'company_financial_adjustment',
      'adjustment_id', _adj.id,
      'reason', COALESCE(NULLIF(trim(_reason), ''), 'Exclusão manual pela tela de Créditos e Débitos'),
      'adjustment_snapshot', to_jsonb(_adj),
      'applications_deleted', _apps
    ),
    now()
  );

  DELETE FROM public.company_financial_adjustments
  WHERE id = _adjustment_id;

  RETURN jsonb_build_object('deleted', true, 'applications_deleted', _app_count);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_company_financial_adjustment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_company_financial_adjustment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_financial_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_financial_adjustment(uuid, text) TO service_role;