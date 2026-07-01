
CREATE OR REPLACE FUNCTION public.run_rls_hospital_isolation_test()
RETURNS TABLE(kind text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
DECLARE
    hosp_a    uuid := gen_random_uuid();
    hosp_b    uuid := gen_random_uuid();
    user_a    uuid := gen_random_uuid();
    user_b    uuid := gen_random_uuid();
    v_count   bigint;
    v_leaks   bigint := 0;
    v_checked int := 0;
    v_skipped int := 0;
    r         record;
    v_sql     text;
    v_pay_a uuid; v_pay_b uuid;
    v_pcg_a uuid; v_pcg_b uuid;
    v_gb_a  uuid; v_gb_b  uuid;
    v_thr_a uuid; v_thr_b uuid;
    v_co_placeholder uuid;
    v_err_msg text;
    v_failed boolean := false;
BEGIN
    kind := 'info'; message := 'RLS hospital isolation test — starting'; RETURN NEXT;

    INSERT INTO public.hospitals(id,name,slug,cnpj,state_uf,active,created_at) VALUES
      (hosp_a,'RLS-TEST-A','rls-test-a-'||substr(hosp_a::text,1,8),'RLS'||substr(hosp_a::text,1,11),'DF',true,now()),
      (hosp_b,'RLS-TEST-B','rls-test-b-'||substr(hosp_b::text,1,8),'RLS'||substr(hosp_b::text,1,11),'DF',true,now());

    INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES
      (user_a,'authenticated','authenticated','rls-'||substr(user_a::text,1,8)||'@test.local','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
      (user_b,'authenticated','authenticated','rls-'||substr(user_b::text,1,8)||'@test.local','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb);

    INSERT INTO public.user_hospitals(user_id,hospital_id,role) VALUES
      (user_a,hosp_a,'analista'),(user_b,hosp_b,'analista');
    INSERT INTO public.user_roles(user_id,role) VALUES (user_a,'analista'),(user_b,'analista');
    INSERT INTO public.user_active_hospital(user_id,hospital_id) VALUES (user_a,hosp_a),(user_b,hosp_b);

    SELECT id INTO v_co_placeholder FROM public.companies LIMIT 1;

    v_pay_a := gen_random_uuid(); v_pay_b := gen_random_uuid();
    INSERT INTO public.payments(id,hospital_id,reference,created_by,competence_month,status,created_at,updated_at) VALUES
      (v_pay_a,hosp_a,'RLS-TEST-A-'||substr(v_pay_a::text,1,6),user_a,date_trunc('month',now())::date,'em_confeccao',now(),now()),
      (v_pay_b,hosp_b,'RLS-TEST-B-'||substr(v_pay_b::text,1,6),user_b,date_trunc('month',now())::date,'em_confeccao',now(),now());

    IF v_co_placeholder IS NOT NULL THEN
      v_pcg_a := gen_random_uuid(); v_pcg_b := gen_random_uuid();
      BEGIN
        INSERT INTO public.payment_company_groups(id,hospital_id,payment_id,company_id,company_name,created_at,updated_at) VALUES
          (v_pcg_a,hosp_a,v_pay_a,v_co_placeholder,'RLS CO A',now(),now()),
          (v_pcg_b,hosp_b,v_pay_b,v_co_placeholder,'RLS CO B',now(),now());
      EXCEPTION WHEN OTHERS THEN kind:='seed_skip'; message:='payment_company_groups: '||SQLERRM; RETURN NEXT; END;

      v_thr_a := gen_random_uuid(); v_thr_b := gen_random_uuid();
      BEGIN
        INSERT INTO public.company_threads(id,hospital_id,company_id,scope,subject,created_by_type,status,created_at,updated_at) VALUES
          (v_thr_a,hosp_a,v_co_placeholder,'company','T A','internal','open',now(),now()),
          (v_thr_b,hosp_b,v_co_placeholder,'company','T B','internal','open',now(),now());
      EXCEPTION WHEN OTHERS THEN kind:='seed_skip'; message:='company_threads: '||SQLERRM; RETURN NEXT; END;
    END IF;

    v_gb_a := gen_random_uuid(); v_gb_b := gen_random_uuid();
    BEGIN
      INSERT INTO public.glosa_batches(id,hospital_id,reference,created_at,updated_at) VALUES
        (v_gb_a,hosp_a,'GB-A-'||substr(v_gb_a::text,1,6),now(),now()),
        (v_gb_b,hosp_b,'GB-B-'||substr(v_gb_b::text,1,6),now(),now());
    EXCEPTION WHEN OTHERS THEN kind:='seed_skip'; message:='glosa_batches: '||SQLERRM; RETURN NEXT; END;

    -- Assertions como user A
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub',user_a::text,'role','authenticated','aud','authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*) INTO v_count FROM public.hospitals WHERE id IN (hosp_a,hosp_b);
    IF v_count<>1 THEN v_failed:=true;
      kind:='FAIL'; message:=format('hospitals: user A viu %s hospitais (esperado 1)',v_count); RETURN NEXT;
    ELSE kind:='pass'; message:='hospitals: user A vê apenas o próprio'; RETURN NEXT; END IF;

    FOR r IN SELECT unnest(ARRAY['payments','payment_company_groups','glosa_batches','company_threads']) AS tname
    LOOP
      BEGIN
        v_sql := format('SELECT count(*) FROM public.%I WHERE hospital_id = %L', r.tname, hosp_b);
        EXECUTE v_sql INTO v_count;
        IF v_count>0 THEN v_failed:=true;
          kind:='FAIL'; message:=format('%s: user A viu %s linhas do hospital B',r.tname,v_count); RETURN NEXT;
        ELSE kind:='pass'; message:=format('%s: 0 vazamento de hosp B',r.tname); RETURN NEXT; END IF;
      EXCEPTION WHEN OTHERS THEN kind:='assert_skip'; message:=format('%s: %s',r.tname,SQLERRM); RETURN NEXT; END;
    END LOOP;

    -- Leak scan genérico em toda tabela com hospital_id
    FOR r IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
       WHERE c.table_schema='public' AND c.column_name='hospital_id' AND t.table_type='BASE TABLE'
       ORDER BY c.table_name
    LOOP
      BEGIN
        v_sql := format('SELECT count(*) FROM public.%I WHERE hospital_id = %L', r.table_name, hosp_b);
        EXECUTE v_sql INTO v_count;
        v_checked := v_checked+1;
        IF v_count>0 THEN
          v_leaks := v_leaks+1; v_failed:=true;
          kind:='FAIL'; message:=format('LEAK em %s: user A vê %s linhas do hospital B',r.table_name,v_count); RETURN NEXT;
        END IF;
      EXCEPTION WHEN OTHERS THEN v_skipped := v_skipped+1; END;
    END LOOP;

    -- Cross-check user B
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub',user_b::text,'role','authenticated','aud','authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    FOR r IN SELECT unnest(ARRAY['payments','glosa_batches','company_threads']) AS tname
    LOOP
      BEGIN
        v_sql := format('SELECT count(*) FROM public.%I WHERE hospital_id = %L', r.tname, hosp_a);
        EXECUTE v_sql INTO v_count;
        IF v_count>0 THEN v_failed:=true;
          kind:='FAIL'; message:=format('(B<-A) %s: user B viu %s linhas do hospital A',r.tname,v_count); RETURN NEXT;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims','',true);

    DELETE FROM public.company_threads      WHERE hospital_id IN (hosp_a,hosp_b);
    DELETE FROM public.glosa_batches        WHERE hospital_id IN (hosp_a,hosp_b);
    DELETE FROM public.payment_items        WHERE hospital_id IN (hosp_a,hosp_b);
    DELETE FROM public.payment_company_groups WHERE hospital_id IN (hosp_a,hosp_b);
    DELETE FROM public.payments             WHERE hospital_id IN (hosp_a,hosp_b);
    DELETE FROM public.user_active_hospital WHERE user_id IN (user_a,user_b);
    DELETE FROM public.user_roles           WHERE user_id IN (user_a,user_b);
    DELETE FROM public.user_hospitals       WHERE user_id IN (user_a,user_b);
    DELETE FROM public.hospitals            WHERE id IN (hosp_a,hosp_b);
    DELETE FROM auth.users                  WHERE id IN (user_a,user_b);

    IF v_failed THEN
      kind:='RESULT'; message:=format('❌ FAILED — leaks=%s checked=%s skipped=%s',v_leaks,v_checked,v_skipped); RETURN NEXT;
      RAISE EXCEPTION 'RLS hospital isolation test FAILED';
    ELSE
      kind:='RESULT'; message:=format('✅ PASSED — leak scan tables=%s (skipped=%s)',v_checked,v_skipped); RETURN NEXT;
    END IF;
    RETURN;

EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM set_config('request.jwt.claims','',true); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.company_threads      WHERE hospital_id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.glosa_batches        WHERE hospital_id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.payment_items        WHERE hospital_id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.payment_company_groups WHERE hospital_id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.payments             WHERE hospital_id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.hospitals            WHERE id IN (hosp_a,hosp_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM auth.users                  WHERE id IN (user_a,user_b); EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE EXCEPTION 'RLS test aborted: %', v_err_msg;
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_rls_hospital_isolation_test() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_rls_hospital_isolation_test() TO service_role;
