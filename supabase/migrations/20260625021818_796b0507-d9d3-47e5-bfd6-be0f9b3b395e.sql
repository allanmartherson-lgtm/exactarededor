CREATE OR REPLACE FUNCTION public.pdv_invalidate_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pool_id uuid;
  v_competence date;
  v_dedu_desc text;
BEGIN
  v_pool_id := COALESCE(NEW.pool_id, OLD.pool_id);
  v_competence := COALESCE(NEW.competence_month, OLD.competence_month);

  SELECT descricao INTO v_dedu_desc
  FROM public.pool_deductions
  WHERE id = COALESCE(NEW.pool_deduction_id, OLD.pool_deduction_id);

  UPDATE public.pool_calculation_runs
  SET invalidated_at = now(),
      invalidated_reason = format('Dedução variável "%s" alterada para %s', COALESCE(v_dedu_desc,'—'), to_char(v_competence,'YYYY-MM'))
  WHERE pool_id = v_pool_id
    AND competence_month = v_competence
    AND invalidated_at IS NULL
    AND status <> 'revertido';

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES (
    'pool_deduction_value',
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    jsonb_build_object(
      'pool_id', v_pool_id,
      'competence_month', v_competence,
      'old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
    )
  );

  RETURN COALESCE(NEW, OLD);
END $function$;