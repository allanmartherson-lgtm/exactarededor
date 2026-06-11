UPDATE public.payment_items
SET package_absorbed = true
WHERE applied_calc_method = 'pacote'
  AND COALESCE(expected_amount, 0) = 0
  AND COALESCE(package_absorbed, false) = false
  AND COALESCE(is_cancelled, false) = false;