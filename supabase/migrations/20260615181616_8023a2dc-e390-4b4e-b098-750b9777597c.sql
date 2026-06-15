
ALTER TABLE public.payments DISABLE TRIGGER USER;
ALTER TABLE public.payment_company_groups DISABLE TRIGGER USER;

UPDATE public.payment_company_groups
SET status = 'revisao_analista',
    approved_by = NULL,
    approved_at = NULL,
    validated_by = NULL,
    validated_at = NULL,
    updated_at = now()
WHERE payment_id IN ('c3aa9687-d766-48c5-9a8b-7b7c1fe0996d','8858db91-b4e4-4fe4-aff2-5e56034b1d73')
  AND status = 'pago';

UPDATE public.payments
SET status = 'em_analise_ia',
    import_mode = 'normal',
    origem = 'fluxo',
    historico_window_start = NULL,
    historico_window_end = NULL,
    updated_at = now()
WHERE id IN ('c3aa9687-d766-48c5-9a8b-7b7c1fe0996d','8858db91-b4e4-4fe4-aff2-5e56034b1d73');

INSERT INTO public.payment_status_history (payment_id, status_from, status_to, changed_at, changed_by, hospital_id)
SELECT id, 'pago', 'em_analise_ia', now(), NULL, hospital_id
FROM public.payments
WHERE id IN ('c3aa9687-d766-48c5-9a8b-7b7c1fe0996d','8858db91-b4e4-4fe4-aff2-5e56034b1d73');

ALTER TABLE public.payments ENABLE TRIGGER USER;
ALTER TABLE public.payment_company_groups ENABLE TRIGGER USER;
