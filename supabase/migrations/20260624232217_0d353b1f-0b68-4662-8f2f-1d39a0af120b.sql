
INSERT INTO public.payment_company_groups
  (payment_id, hospital_id, company_id, company_name, items_count, total_amount, bruto_total, status, confeccao_status)
SELECT
  p.id,
  p.hospital_id,
  pp.company_id,
  c.name,
  0, 0, 0,
  'rascunho',
  'em_confeccao'
FROM public.payments p
JOIN public.pool_participants pp ON pp.pool_id = p.pool_id AND pp.percentual > 0 AND pp.company_id IS NOT NULL
JOIN public.companies c ON c.id = pp.company_id
WHERE p.id = 'bf42afed-7787-469e-8467-2db866b58bbf'
ON CONFLICT (payment_id, company_id) DO NOTHING;
