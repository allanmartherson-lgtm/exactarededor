ALTER TABLE public.payment_items DROP CONSTRAINT payment_items_payment_id_fkey;
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;