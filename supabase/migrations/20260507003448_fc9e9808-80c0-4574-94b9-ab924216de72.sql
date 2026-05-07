UPDATE public.payment_items
SET procedure_amount = gross_amount
WHERE procedure_amount IS NULL AND gross_amount > 0;