CREATE INDEX IF NOT EXISTS idx_payment_items_applied_calc_id
  ON public.payment_items(applied_calc_id)
  WHERE applied_calc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_items_package_absorbed_calc_id
  ON public.payment_items(package_absorbed_calc_id)
  WHERE package_absorbed_calc_id IS NOT NULL;