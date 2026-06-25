UPDATE public.payment_company_groups
  SET status='pago', updated_at=now()
  WHERE payment_id='08850129-80bd-4dd9-b629-1782fff3282a';

SELECT public.recompute_payment_status_from_groups('08850129-80bd-4dd9-b629-1782fff3282a'::uuid);