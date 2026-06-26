UPDATE public.validation_rules
SET kind = 'duplicidade_lancamento'::validation_kind,
    params = jsonb_build_object(
      'compare_attendance', COALESCE((params->>'compare_attendance')::boolean, true),
      'compare_patient',    COALESCE((params->>'compare_patient')::boolean, true),
      'compare_date',       COALESCE((params->>'compare_date')::boolean, true),
      'compare_code',       COALESCE((params->>'compare_code')::boolean, true),
      'compare_role',       COALESCE((params->>'compare_role')::boolean, false),
      'compare_access_route', COALESCE((params->>'compare_access_route')::boolean, false),
      'doctor_mode',        CASE WHEN COALESCE((params->>'compare_doctor')::boolean, true) THEN 'same' ELSE 'any' END,
      'window_days',        0
    )
WHERE kind = 'duplicidade_exata';

UPDATE public.validation_rules
SET kind = 'duplicidade_lancamento'::validation_kind,
    params = jsonb_build_object(
      'compare_attendance', COALESCE((params->>'compare_attendance')::boolean, true),
      'compare_patient',    COALESCE((params->>'compare_patient')::boolean, true),
      'compare_date',       COALESCE((params->>'compare_date')::boolean, true),
      'compare_code',       COALESCE((params->>'compare_code')::boolean, true),
      'compare_role',       false,
      'compare_access_route', false,
      'doctor_mode',        CASE WHEN COALESCE((params->>'allow_different_doctors')::boolean, true) THEN 'any' ELSE 'same' END,
      'window_days',        0
    )
WHERE kind = 'duplicidade_atendimento';