-- Escopo de hospital nas tabelas de log/auditoria que ficaram de fora dos dois
-- lotes anteriores (20260701180428 e 20260807050001).
--
-- Situação encontrada: as 4 tabelas abaixo têm hospital_id, já foram
-- backfilladas e já têm o trigger trg_enforce_hospital_scope preenchendo
-- hospital_id no INSERT — mas a leitura continuou valendo só por PAPEL
-- (has_role admin/diretor/validador/analista), sem nenhuma checagem de
-- hospital. Na prática, qualquer analista de qualquer hospital lia o log de
-- TODOS os hospitais.
--
-- Exemplo do que estava aberto (specialty_audit_log):
--   CREATE POLICY "Staff can read specialty audit log"
--   FOR SELECT TO authenticated
--   USING (has_role(...,'admin') OR ... OR has_role(...,'analista'));
--
-- Aplicamos aqui o MESMO par de policies RESTRICTIVE usado em payments,
-- payment_company_groups, payment_items, invoices, payment_company_financials
-- e payment_observations. RESTRICTIVE compõe com AND sobre as permissivas
-- existentes, então as regras de papel continuam valendo — só passam a ser
-- limitadas ao hospital.
--
-- ESCOPO DELIBERADO: só entram tabelas que já têm backfill E trigger de
-- INSERT. A segunda policy exige `hospital_id IS NOT NULL`; aplicá-la a uma
-- tabela com linhas de hospital_id nulo esconderia essas linhas de todo
-- usuário não-global, e sem o trigger as linhas NOVAS também nasceriam
-- invisíveis. As demais tabelas sem escopo precisam de backfill + trigger
-- antes e ficaram fora de propósito (ver nota no fim).

-- Rede de segurança: se sobrou alguma linha com hospital_id nulo entre o
-- backfill de 20260707173419 e a criação do trigger, ela ficaria invisível
-- após as policies. Fecha esse buraco antes de aplicar a restrição.
DO $$
DECLARE
  v_default uuid;
  t text;
BEGIN
  SELECT id INTO v_default FROM public.hospitals WHERE slug = 'df-star' LIMIT 1;
  IF v_default IS NULL THEN
    SELECT id INTO v_default FROM public.hospitals ORDER BY created_at LIMIT 1;
  END IF;

  IF v_default IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY[
      'specialty_audit_log',
      'payment_recompute_failures',
      'pendencia_notification_log',
      'pendencia_routing_log'
    ]
    LOOP
      EXECUTE format(
        'UPDATE public.%I SET hospital_id = $1 WHERE hospital_id IS NULL', t
      ) USING v_default;
    END LOOP;
  END IF;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'specialty_audit_log',
    'payment_recompute_failures',
    'pendencia_notification_log',
    'pendencia_routing_log'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_hospital_scope ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I', t);

    -- 1) Hospital ATIVO na sessão: mesmo que o usuário tenha acesso a vários
    --    hospitais, só enxerga o que pertence ao que está selecionado.
    EXECUTE format($f$
      CREATE POLICY active_hospital_scope
      ON public.%I
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (
        hospital_id IS NULL
        OR hospital_id = (SELECT public.current_active_hospital())
      )
      WITH CHECK (
        hospital_id IS NULL
        OR hospital_id = (SELECT public.current_active_hospital())
      )
    $f$, t);

    -- 2) Vínculo real do usuário: papel global vê tudo; os demais só os
    --    hospitais aos quais estão vinculados.
    EXECUTE format($f$
      CREATE POLICY hospital_scope_restrictive
      ON public.%I
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (
        (SELECT public.is_global_role(auth.uid()))
        OR (
          hospital_id IS NOT NULL
          AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
        )
      )
      WITH CHECK (
        (SELECT public.is_global_role(auth.uid()))
        OR (
          hospital_id IS NOT NULL
          AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
        )
      )
    $f$, t);
  END LOOP;
END $$;

-- NOTA — tabelas com hospital_id que seguem SEM escopo de hospital, e por quê:
--
-- Precisam de backfill + trigger antes (aplicar as policies hoje esconderia
-- linhas com hospital_id nulo):
--   special_case_marks, export_log, payout_models, payout_tier_tables,
--   system_parameter_overrides, communication_sla_settings, ai_retry_queue
--
-- Não devem receber este par de policies:
--   company_portal_user_hospitals, doctor_portal_user_hospitals — são as
--     tabelas que DEFINEM o escopo dos usuários de portal, que não estão em
--     user_hospitals; restringi-las por user_hospital_ids() travaria o portal.
--   comm_campaigns — leitura por destinatário (empresa/médico do portal),
--     mesmo risco de travar quem não é staff interno.
--   deduction_run_locks — mecanismo de lock de service_role.
--
-- Já protegidas de outra forma (não precisam):
--   ai_checklist_cache, company_access_log — RLS ligada sem nenhuma policy
--     para authenticated, ou seja, inacessíveis fora do service_role.
--   agreement_registration_events — escopada via can_access_agreement().
