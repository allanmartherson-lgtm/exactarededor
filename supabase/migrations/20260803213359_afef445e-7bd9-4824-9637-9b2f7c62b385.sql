CREATE OR REPLACE FUNCTION public.rls_test_setup(_user_a uuid, _user_b uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    hosp_a uuid := gen_random_uuid();
    hosp_b uuid := gen_random_uuid();
    v_co   uuid;
    v_pay_a uuid := gen_random_uuid();
    v_pay_b uuid := gen_random_uuid();
    v_grp_a uuid := gen_random_uuid();
    v_grp_b uuid := gen_random_uuid();
    v_inv_a uuid := gen_random_uuid();
    v_inv_b uuid := gen_random_uuid();
    v_item_b uuid := gen_random_uuid();
    v_obs_b uuid := gen_random_uuid();
    v_item_err text := NULL;
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
          (v_grp_a,hosp_a,v_pay_a,v_co,'RLS CO A',now(),now()),
          (v_grp_b,hosp_b,v_pay_b,v_co,'RLS CO B',now(),now());
      EXCEPTION WHEN OTHERS THEN v_grp_a := NULL; v_grp_b := NULL; END;
      BEGIN
        INSERT INTO public.company_threads(id,hospital_id,company_id,scope,subject,created_by_type,status,created_at,updated_at) VALUES
          (gen_random_uuid(),hosp_a,v_co,'company','T A','internal','open',now(),now()),
          (gen_random_uuid(),hosp_b,v_co,'company','T B','internal','open',now(),now());
      EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        INSERT INTO public.payment_company_financials(id,hospital_id,payment_id,company_id,created_at,updated_at) VALUES
          (gen_random_uuid(),hosp_a,v_pay_a,v_co,now(),now()),
          (gen_random_uuid(),hosp_b,v_pay_b,v_co,now(),now());
      EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        INSERT INTO public.payment_items(id,hospital_id,payment_id,company_id,doctor_name,created_at) VALUES
          (gen_random_uuid(),hosp_a,v_pay_a,v_co,'RLS TEST DOC A',now()),
          (v_item_b,hosp_b,v_pay_b,v_co,'RLS TEST DOC B',now());
      EXCEPTION WHEN OTHERS THEN v_item_b := NULL; v_item_err := SQLERRM; END;
    ELSE
      v_grp_a := NULL; v_grp_b := NULL; v_item_b := NULL;
      v_item_err := 'sem empresa cadastrada para fixture';
    END IF;

    BEGIN
      INSERT INTO public.glosa_batches(id,hospital_id,reference,created_at,updated_at) VALUES
        (gen_random_uuid(),hosp_a,'GB-A-'||substr(hosp_a::text,1,6),now(),now()),
        (gen_random_uuid(),hosp_b,'GB-B-'||substr(hosp_b::text,1,6),now(),now());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
      INSERT INTO public.invoices(id,hospital_id,payment_id,expected_amount,recipient_email,created_at,updated_at) VALUES
        (v_inv_a,hosp_a,v_pay_a,100,'rls-a@test.local',now(),now()),
        (v_inv_b,hosp_b,v_pay_b,100,'rls-b@test.local',now(),now());
    EXCEPTION WHEN OTHERS THEN v_inv_a := NULL; v_inv_b := NULL; END;

    BEGIN
      INSERT INTO public.payment_observations(id,hospital_id,payment_id,author_type,message,created_at) VALUES
        (gen_random_uuid(),hosp_a,v_pay_a,'sistema','RLS TEST OBS A',now()),
        (v_obs_b,hosp_b,v_pay_b,'sistema','RLS TEST OBS B',now());
    EXCEPTION WHEN OTHERS THEN v_obs_b := NULL; END;

    RETURN jsonb_build_object(
      'hosp_a', hosp_a, 'hosp_b', hosp_b,
      'pay_a', v_pay_a, 'pay_b', v_pay_b,
      'group_a', v_grp_a, 'group_b', v_grp_b,
      'invoice_a', v_inv_a, 'invoice_b', v_inv_b,
      'item_b', v_item_b, 'obs_b', v_obs_b,
      'item_err', v_item_err,
      'company_id', v_co
    );
END;
$fn$;