
WITH affected AS (
  SELECT rc.id, rc.rule_id, rc.time_mode, r.hospital_id
  FROM public.rule_calculations rc
  JOIN public.rules r ON r.id = rc.rule_id
  WHERE rc.time_mode IN ('fim_de_semana','comercial')
    AND (rc.weekdays IS NULL OR array_length(rc.weekdays,1) IS NULL)
),
updated AS (
  UPDATE public.rule_calculations rc
  SET weekdays = CASE a.time_mode
                   WHEN 'fim_de_semana' THEN ARRAY[0,6]
                   WHEN 'comercial'     THEN ARRAY[1,2,3,4,5]
                 END,
      has_conditions = true
  FROM affected a
  WHERE rc.id = a.id
  RETURNING rc.id, a.rule_id, a.time_mode, a.hospital_id, rc.weekdays
)
INSERT INTO public.audit_log(entity_type, entity_id, action, hospital_id, diff)
SELECT 'rule_calculation', u.id, 'update', u.hospital_id,
       jsonb_build_object(
         'reason','backfill_weekdays_preset_serializer_bug',
         'rule_id', u.rule_id,
         'time_mode', u.time_mode,
         'weekdays_after', u.weekdays
       )
FROM updated u;
