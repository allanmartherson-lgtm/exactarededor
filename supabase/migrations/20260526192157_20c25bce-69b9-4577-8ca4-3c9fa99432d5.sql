
ALTER TABLE public.glosa_debts
  ADD COLUMN IF NOT EXISTS ignored_at timestamptz,
  ADD COLUMN IF NOT EXISTS ignored_by uuid,
  ADD COLUMN IF NOT EXISTS ignored_reason text;

CREATE OR REPLACE FUNCTION public.ignore_glosa_debt(_debt_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Motivo obrigatório para ignorar glosa';
  END IF;

  UPDATE public.glosa_debts
     SET status = 'ignorada',
         resolution_status = 'ignorada',
         resolution_reason = 'ignorada_pelo_analista',
         ignored_at = now(),
         ignored_by = _uid,
         ignored_reason = trim(_reason),
         updated_at = now()
   WHERE id = _debt_id
     AND status = 'ativo';

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('glosa_debt', _debt_id, 'ignore', _uid,
          jsonb_build_object('reason', trim(_reason)));
END;
$$;

CREATE OR REPLACE FUNCTION public.unignore_glosa_debt(_debt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  UPDATE public.glosa_debts
     SET status = 'ativo',
         resolution_status = 'pendente_resolucao',
         ignored_at = NULL,
         ignored_by = NULL,
         ignored_reason = NULL,
         updated_at = now()
   WHERE id = _debt_id
     AND status = 'ignorada';

  -- re-resolve para repopular reason/company_id sugerido
  PERFORM public.resolve_glosa_to_company(_debt_id);

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('glosa_debt', _debt_id, 'unignore', _uid, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ignore_glosa_debt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unignore_glosa_debt(uuid) TO authenticated;
