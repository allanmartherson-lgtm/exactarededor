
CREATE OR REPLACE FUNCTION public.rls_test_cleanup(_hosp_a uuid, _hosp_b uuid, _user_a uuid, _user_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
BEGIN
    DELETE FROM public.company_threads        WHERE hospital_id IN (_hosp_a,_hosp_b);
    DELETE FROM public.glosa_batches          WHERE hospital_id IN (_hosp_a,_hosp_b);
    DELETE FROM public.payment_items          WHERE hospital_id IN (_hosp_a,_hosp_b);
    DELETE FROM public.payment_company_groups WHERE hospital_id IN (_hosp_a,_hosp_b);
    DELETE FROM public.payments               WHERE hospital_id IN (_hosp_a,_hosp_b);
    DELETE FROM public.user_active_hospital   WHERE user_id IN (_user_a,_user_b);
    DELETE FROM public.user_roles             WHERE user_id IN (_user_a,_user_b);
    DELETE FROM public.user_hospitals         WHERE user_id IN (_user_a,_user_b);
    DELETE FROM public.hospitals              WHERE id IN (_hosp_a,_hosp_b);
END;
$fn$;
