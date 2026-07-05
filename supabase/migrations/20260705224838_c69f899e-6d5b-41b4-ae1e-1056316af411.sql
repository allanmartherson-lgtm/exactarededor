UPDATE public.payments
SET import_mode = 'historico',
    updated_at = now()
WHERE id IN (
  'a58259a4-fdf1-43f9-8f9b-311048b88e78',
  'dcb3baf1-efa0-4a54-b1a9-848dc1ba1baf'
);