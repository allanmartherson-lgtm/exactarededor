
DELETE FROM public.pool_calculation_runs r
WHERE payment_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = r.payment_id);

ALTER TABLE public.pool_calculation_runs
  DROP CONSTRAINT IF EXISTS pool_calculation_runs_payment_id_fkey;

ALTER TABLE public.pool_calculation_runs
  ADD CONSTRAINT pool_calculation_runs_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;
