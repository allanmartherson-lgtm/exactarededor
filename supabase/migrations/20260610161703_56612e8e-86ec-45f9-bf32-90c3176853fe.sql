DELETE FROM public.glosa_payment_applications gpa
USING public.glosa_debts gd
WHERE gpa.glosa_debt_id = gd.id
  AND gpa.status = 'proposto'
  AND (
    gd.confirmed_at IS NULL
    OR gd.target_payment_id IS NULL
    OR gd.target_payment_id <> gpa.payment_id
  );