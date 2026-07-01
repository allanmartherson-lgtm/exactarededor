
DROP FUNCTION IF EXISTS public.rls_test_setup(text);

CREATE OR REPLACE FUNCTION public.rls_test_setup(_user_a uuid, _user_b uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
DECLARE
    hosp_a uuid := gen_random_uuid();
    hosp_b uuid := gen_random_uuid();
    v_co   uuid;
    v_pay_a uuid := gen_random_uuid();
    v_pay_b uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.hospitals(id,name,slug,cnpj,state_uf,active,created_at) VALUES
      (hosp_a,'RLS-TEST-A','rls-test-a-'||substr(hosp_a::text,1,8),'RLS'||substr(hosp_a::text,1,11),'DF',true,now()),
      (hosp_b,'RLS-TEST-B','rls-test-b-'||substr(hosp_b::text,1,8),'RLS'||substr(hosp_b::text,1,11),'DF',true,now());

    INSERT INTO public.user_hospitals(user_id,hospital_id,role) VALUES
      (_user_a,hosp_a,'analista'),(_user_b,hosp_b,'analista');
    INSERT INTO public.user_roles(user_id,role) VALUES (_user_a,'analista'),(_user_b,'analista')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_active_hospital(user_id,hospital_id) VALUES (_user_a,hosp_a),(_user_b,hosp_b)
      ON CONFLICT (user_id) DO UPDATE SET hospital_id = EXCLUDED.hospital_id;

    SELECT id INTO v_co FROM public.companies LIMIT 1;

    INSERT INTO public.payments(id,hospital_id,reference,created_by,competence_month,status,created_at,updated_at) VALUES
      (v_pay_a,hosp_a,'RLS-TEST-A-'||substr(v_pay_a::text,1,6),_user_a,date_trunc('month',now())::date,'em_confeccao',now(),now()),
      (v_pay_b,hosp_b,'RLS-TEST-B-'||substr(v_pay_b::text,1,6),_user_b,date_trunc('month',now())::date,'em_confeccao',now(),now());

    IF v_co IS NOT NULL THEN
      BEGIN
        INSERT INTO public.payment_company_groups(id,hospital_id,payment_id,company_id,company_name,created_at,updated_at) VALUES
          (gen_random_uuid(),hosp_a,v_pay_a,v_co,'RLS CO A',now(),now()),
          (gen_random_uuid(),hosp_b,v_pay_b,v_co,'RLS CO B',now(),now());
      EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        INSERT INTO public.company_threads(id,hospital_id,company_id,scope,subject,created_by_type,status,created_at,updated_at) VALUES
          (gen_random_uuid(),hosp_a,v_co,'company','T A','internal','open',now(),now()),
          (gen_random_uuid(),hosp_b,v_co,'company','T B','internal','open',now(),now());
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    BEGIN
      INSERT INTO public.glosa_batches(id,hospital_id,reference,created_at,updated_at) VALUES
        (gen_random_uuid(),hosp_a,'GB-A-'||substr(hosp_a::text,1,6),now(),now()),
        (gen_random_uuid(),hosp_b,'GB-B-'||substr(hosp_b::text,1,6),now(),now());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object('hosp_a', hosp_a, 'hosp_b', hosp_b);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rls_test_setup(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_test_setup(uuid,uuid) TO service_role;
