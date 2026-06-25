DO $$
BEGIN
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
     SET status = 'revisao_analista', updated_at = now()
   WHERE id = '8e599a96-1d09-4b9e-99e9-353cba7e7c76';
END $$;