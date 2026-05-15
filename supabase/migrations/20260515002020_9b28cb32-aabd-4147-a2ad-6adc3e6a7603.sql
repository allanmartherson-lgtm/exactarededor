-- 1. Remover registros órfãos que não possuem um pagamento correspondente
DELETE FROM public.payment_status_history WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_assignments WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.invoice_questions WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_items WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_observations WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.payment_company_groups WHERE payment_id NOT IN (SELECT id FROM public.payments);
DELETE FROM public.invoices WHERE payment_id NOT IN (SELECT id FROM public.payments);

-- 2. Estabelecer chaves estrangeiras com exclusão em cascata
ALTER TABLE public.payment_status_history
DROP CONSTRAINT IF EXISTS payment_status_history_payment_id_fkey,
ADD CONSTRAINT payment_status_history_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.payment_assignments
DROP CONSTRAINT IF EXISTS payment_assignments_payment_id_fkey,
ADD CONSTRAINT payment_assignments_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.invoice_questions
DROP CONSTRAINT IF EXISTS invoice_questions_payment_id_fkey,
ADD CONSTRAINT invoice_questions_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.payment_items
DROP CONSTRAINT IF EXISTS payment_items_payment_id_fkey,
ADD CONSTRAINT payment_items_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.payment_observations
DROP CONSTRAINT IF EXISTS payment_observations_payment_id_fkey,
ADD CONSTRAINT payment_observations_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.payment_company_groups
DROP CONSTRAINT IF EXISTS payment_company_groups_payment_id_fkey,
ADD CONSTRAINT payment_company_groups_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;

ALTER TABLE public.invoices
DROP CONSTRAINT IF EXISTS invoices_payment_id_fkey,
ADD CONSTRAINT invoices_payment_id_fkey 
  FOREIGN KEY (payment_id) 
  REFERENCES public.payments(id) 
  ON DELETE CASCADE;