UPDATE public.procedure_specialty_map
SET status = 'aprovado',
    approved_at = now()
WHERE status = 'sugerido';