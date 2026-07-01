
DROP FUNCTION IF EXISTS public.run_rls_hospital_isolation_test();

CREATE OR REPLACE FUNCTION public.rls_test_setup(_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
DECLARE
    hosp_a uuid := gen_random_uuid();
    hosp_b uuid := gen_random_uuid();
    user_a uuid := gen_random_uuid();
    user_b uuid := gen_random_uuid();
    email_a text := 'rls-'||substr(user_a::text,1,8)||'@test.local';
    email_b text := 'rls-'||substr(user_b::text,1,8)||'@test.local';
    v_co    uuid;
    v_pay_a uuid := gen_random_uuid();
    v_pay_b uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.hospitals(id,name,slug,cnpj,state_uf,active,created_at) VALUES
      (hosp_a,'RLS-TEST-A','rls-test-a-'||substr(hosp_a::text,1,8),'RLS'||substr(hosp_a::text,1,11),'DF',true,now()),
      (hosp_b,'RLS-TEST-B','rls-test-b-'||substr(hosp_b::text,1,8),'RLS'||substr(hosp_b::text,1,11),'DF',true,now());

    INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES
      (user_a,'authenticated','authenticated',email_a, crypt(_password, gen_salt('bf')), now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb),
      (user_b,'authenticated','authenticated',email_b, crypt(_password, gen_salt('bf')), now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb);

    INSERT INTO public.user_hospitals(user_id,hospital_id,role) VALUES
      (user_a,hosp_a,'analista'),(user_b,hosp_b,'analista');
    INSERT INTO public.user_roles(user_id,role) VALUES (user_a,'analista'),(user_b,'analista');
    INSERT INTO public.user_active_hospital(user_id,hospital_id) VALUES (user_a,hosp_a),(user_b,hosp_b);

    SELECT id INTO v_co FROM public.companies LIMIT 1;

    INSERT INTO public.payments(id,hospital_id,reference,created_by,competence_month,status,created_at,updated_at) VALUES
      (v_pay_a,hosp_a,'RLS-TEST-A-'||substr(v_pay_a::text,1,6),user_a,date_trunc('month',now())::date,'em_confeccao',now(),now()),
      (v_pay_b,hosp_b,'RLS-TEST-B-'||substr(v_pay_b::text,1,6),user_b,date_trunc('month',now())::date,'em_confeccao',now(),now());

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

    RETURN jsonb_build_object(
      'hosp_a', hosp_a, 'hosp_b', hosp_b,
      'user_a', user_a, 'user_b', user_b,
      'email_a', email_a, 'email_b', email_b
    );
END;
$fn$;

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
    DELETE FROM auth.users                    WHERE id IN (_user_a,_user_b);
END;
$fn$;

-- Lista de tabelas com hospital_id para o leak scan
CREATE OR REPLACE FUNCTION public.rls_test_hospital_tables()
RETURNS TABLE(table_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.table_name::text
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name
   WHERE c.table_schema='public'
     AND c.column_name='hospital_id'
     AND t.table_type='BASE TABLE'
   ORDER BY c.table_name
$$;

REVOKE ALL ON FUNCTION public.rls_test_setup(text)                            FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_test_cleanup(uuid,uuid,uuid,uuid)           FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_test_hospital_tables()                      FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_test_setup(text)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_test_cleanup(uuid,uuid,uuid,uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_test_hospital_tables()                    TO service_role;
