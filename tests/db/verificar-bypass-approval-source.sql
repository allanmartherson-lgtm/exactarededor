-- Verificação: a trigger guard_group_workflow_transition() (criada em
-- 20260803211001_146da22b-c6c9-4b1f-ae94-d5cf958a3802.sql) só valida papel
-- de quem transiciona payment_company_groups.status quando
-- approval_source/validation_source = 'system'. Como essas colunas não têm
-- nenhuma restrição além do CHECK de valores permitidos
-- (system|magic_link|email|whatsapp|outro), a hipótese é que um usuário com
-- papel 'analista' consiga se auto-aprovar simplesmente enviando
-- approval_source='outro' junto com status='aprovado' no mesmo UPDATE,
-- pulando inteiramente o gate "só diretor" e o gate de segregação de funções.
--
-- Este script testa a hipótese em uma transação com ROLLBACK garantido no
-- final — não deixa nenhum dado de teste no banco, mesmo se o teste
-- confirmar o bypass.
--
-- Uso: psql "$STAGING_URL" -f tests/db/verificar-bypass-approval-source.sql
-- Rodar em STAGING, nunca direto em produção.
-- Requer conexão com privilégio suficiente para SET ROLE authenticated
-- (a mesma connection string usada pelos outros scripts em tests/db/).

\set ON_ERROR_STOP off

BEGIN;
  SAVEPOINT s_bypass_test;

  DO $$
  DECLARE
    v_hospital       uuid := gen_random_uuid();
    v_analista       uuid := gen_random_uuid();
    v_outro_criador  uuid := gen_random_uuid(); -- não é quem vai tentar aprovar
    v_payment        uuid := gen_random_uuid();
    v_group          uuid := gen_random_uuid();
    v_status_depois  public.payment_status;
    v_approval_src   text;
  BEGIN
    -- 1) Fixture mínima: hospital + analista com role real + pagamento criado
    --    por OUTRA pessoa (pra não cair no bloqueio de "quem cria não pode
    --    aprovar", que é um teste diferente).
    INSERT INTO public.hospitals (id, name, slug, active)
    VALUES (v_hospital, '__TESTE_BYPASS__', '__teste_bypass__', true);

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_analista, 'analista'::public.app_role);

    INSERT INTO public.user_hospitals (user_id, hospital_id)
    VALUES (v_analista, v_hospital);

    INSERT INTO public.payments (id, hospital_id, status, created_by, analysis_mode)
    VALUES (v_payment, v_hospital, 'aguardando_aprovacao'::public.payment_status, v_outro_criador, 'padrao');

    INSERT INTO public.payment_company_groups
      (id, payment_id, hospital_id, company_id, status, items_count, total_amount)
    VALUES (v_group, v_payment, v_hospital, NULL, 'aguardando_aprovacao'::public.payment_status, 0, 0);

    -- 2) Simula uma requisição HTTP autenticada como o analista (mesmo
    --    mecanismo que PostgREST usa para expor auth.uid() dentro de RLS).
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_analista::text, 'role', 'authenticated')::text,
      true);
    SET LOCAL ROLE authenticated;

    -- 3) A tentativa de exploração: analista se auto-aprova alegando que a
    --    aprovação "veio de fora" (approval_source = 'outro'), sem nunca ter
    --    papel de diretor.
    BEGIN
      UPDATE public.payment_company_groups
         SET status = 'aprovado'::public.payment_status,
             approval_source = 'outro',
             approved_by = v_analista,
             approved_at = now()
       WHERE id = v_group;

      RESET ROLE;

      SELECT status, approval_source INTO v_status_depois, v_approval_src
        FROM public.payment_company_groups WHERE id = v_group;

      IF v_status_depois = 'aprovado'::public.payment_status THEN
        RAISE WARNING 'BYPASS CONFIRMADO: analista conseguiu se auto-aprovar via approval_source=''%''. status final=%',
          v_approval_src, v_status_depois;
      ELSE
        RAISE NOTICE 'Inesperado: UPDATE não deu erro mas status ficou em % (esperava aprovado ou exceção)', v_status_depois;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'OK — bypass BLOQUEADO. Erro retornado: % (%)', SQLERRM, SQLSTATE;
    END;

  END $$;

  ROLLBACK TO SAVEPOINT s_bypass_test;
ROLLBACK;

-- Leia a saída acima:
--   "BYPASS CONFIRMADO"  -> a hipótese do achado A está certa, precisa corrigir
--                           guard_group_workflow_transition (ver sugestão no
--                           relatório: o gate de papel não deveria depender
--                           de approval_source = 'system').
--   "OK — bypass BLOQUEADO" -> algo além do que eu vi no código também está
--                           protegendo esse caminho (ex.: RLS mais restritiva
--                           do que a que encontrei, ou GRANT por coluna) —
--                           me mande o erro retornado que eu reviso a causa.
