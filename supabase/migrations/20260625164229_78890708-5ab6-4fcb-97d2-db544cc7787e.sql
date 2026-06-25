
ALTER TABLE public.payments DISABLE TRIGGER USER;

UPDATE public.payments
SET status = 'rascunho',
    approved_by = NULL,
    approved_at = NULL,
    validated_by = NULL,
    validated_at = NULL,
    updated_at = now()
WHERE id IN (
  '08850129-80bd-4dd9-b629-1782fff3282a',
  'cf8b7307-fbec-4864-a7ee-8709a1f99db3',
  '8e599a96-1d09-4b9e-99e9-353cba7e7c76',
  'd1c3b770-ef3f-4b5c-be45-13821683028e'
);

ALTER TABLE public.payments ENABLE TRIGGER USER;
