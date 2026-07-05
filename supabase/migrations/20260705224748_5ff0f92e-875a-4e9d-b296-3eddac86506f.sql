UPDATE public.payments
SET import_mode = 'historico',
    updated_at = now()
WHERE id = '57af590e-0df4-436f-ac7b-a26aacc71332';