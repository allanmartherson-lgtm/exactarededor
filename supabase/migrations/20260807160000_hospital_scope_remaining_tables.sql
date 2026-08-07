-- Fecha as 7 tabelas com hospital_id que ainda liam entre hospitais.
--
-- Complementa 20260807150000 (logs de auditoria). Aqui as tabelas exigem
-- tratamentos DIFERENTES, porque `hospital_id IS NULL` não significa a mesma
-- coisa em todas elas:
--
--   Grupo A — hospital_id sempre preenchido (ou passa a ser, via pai).
--             Recebe o par de policies padrão das tabelas irmãs.
--
--   Grupo B — NULL é SEMÂNTICO: significa "vale para todos os hospitais".
--             Confirmado em duas delas:
--               · communication_sla_settings: o seed de 20260601203504 insere
--                 os canais SEM hospital_id, com UNIQUE (channel, hospital_id).
--                 São os SLAs padrão da operação.
--               · system_parameter_overrides: a coluna `priority` é GENERATED
--                 somando `hospital_id IS NOT NULL` como +1 de especificidade.
--                 NULL é o nível global da hierarquia de parâmetros.
--             Aplicar a policy padrão aqui ESCONDERIA esses defaults de todo
--             usuário não-global e quebraria o fallback de configuração.
--             Solução: leitura tolera NULL; escrita continua estrita (só papel
--             global cria/edita registro global).

-- ===========================================================================
-- GRUPO A.1 — herda hospital_id do pagamento pai
-- ===========================================================================
-- special_case_marks e ai_retry_queue têm payment_id; payments.hospital_id é
-- NOT NULL desde 20260617154953, então a origem é confiável.

UPDATE public.special_case_marks m
   SET hospital_id = p.hospital_id
  FROM public.payments p
 WHERE m.payment_id = p.id
   AND m.hospital_id IS NULL;

-- Marca sem payment_id: tenta pelo item.
UPDATE public.special_case_marks m
   SET hospital_id = i.hospital_id
  FROM public.payment_items i
 WHERE m.item_id = i.id
   AND m.hospital_id IS NULL
   AND i.hospital_id IS NOT NULL;

UPDATE public.ai_retry_queue q
   SET hospital_id = p.hospital_id
  FROM public.payments p
 WHERE q.payment_id = p.id
   AND q.hospital_id IS NULL;

-- Novos registros herdam do pai automaticamente (mesma função já usada em
-- payment_items, payment_company_groups, payment_observations etc).
DROP TRIGGER IF EXISTS trg_hospital_from_parent ON public.special_case_marks;
CREATE TRIGGER trg_hospital_from_parent
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.special_case_marks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

-- Rede para a marca criada só com item_id: o trigger acima devolve NEW intacto
-- quando payment_id é nulo, e a linha ficaria com hospital_id NULL — invisível
-- pela policy do Grupo A. Este segundo trigger roda depois (ordem alfabética do
-- nome) e preenche a partir do item. Se os dois pais discordarem, a própria
-- função levanta a violação multi-tenant, que é o comportamento desejado.
DROP TRIGGER IF EXISTS trg_hospital_from_parent_item ON public.special_case_marks;
CREATE TRIGGER trg_hospital_from_parent_item
  BEFORE INSERT OR UPDATE OF hospital_id, item_id ON public.special_case_marks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payment_items', 'item_id');

DROP TRIGGER IF EXISTS trg_hospital_from_parent ON public.ai_retry_queue;
CREATE TRIGGER trg_hospital_from_parent
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.ai_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

-- ===========================================================================
-- GRUPO A.2 — policies padrão
-- ===========================================================================
-- payout_models já nasce com hospital_id NOT NULL, não precisa de backfill.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'special_case_marks',
    'ai_retry_queue',
    'payout_models'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_hospital_scope ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I', t);

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

-- ===========================================================================
-- GRUPO B — NULL = configuração global, precisa continuar visível
-- ===========================================================================
-- Diferença para o Grupo A: o USING tolera hospital_id NULL (senão o default
-- global some para quem não é papel global). O WITH CHECK continua idêntico ao
-- padrão — ou seja, criar/editar registro GLOBAL segue exigindo papel global.
-- Escrita nessas tabelas já era restrita a admin pelas policies permissivas
-- existentes; isto apenas garante que ninguém "promova" um registro para
-- global a partir de um hospital.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'communication_sla_settings',
    'system_parameter_overrides',
    'payout_tier_tables'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_hospital_scope ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I', t);

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

    EXECUTE format($f$
      CREATE POLICY hospital_scope_restrictive
      ON public.%I
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (
        hospital_id IS NULL
        OR (SELECT public.is_global_role(auth.uid()))
        OR hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
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

-- ===========================================================================
-- export_log — sem pai de onde herdar
-- ===========================================================================
-- hospital_id vem do contexto da sessão no app (`hospitalId ?? null` em
-- src/lib/exportLog.ts), sem FK e sem trigger. Registros antigos podem ter
-- NULL e não há como atribuí-los a um hospital retroativamente sem chutar.
--
-- Em vez de escondê-los (o usuário perderia o próprio histórico) ou liberá-los
-- para todos (os `filters` podem carregar dado do lote), o NULL fica visível
-- apenas para quem gerou o export — que já é o critério de uma das policies
-- permissivas da tabela — ou para papel global.

DROP POLICY IF EXISTS active_hospital_scope ON public.export_log;
DROP POLICY IF EXISTS hospital_scope_restrictive ON public.export_log;

CREATE POLICY active_hospital_scope
ON public.export_log
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
);

CREATE POLICY hospital_scope_restrictive
ON public.export_log
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
  -- Registros anteriores ao escopo por hospital: só o próprio autor enxerga.
  OR (hospital_id IS NULL AND user_id = (SELECT auth.uid()))
)
WITH CHECK (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
  OR (hospital_id IS NULL AND user_id = (SELECT auth.uid()))
);

-- ===========================================================================
-- Situação final das tabelas com hospital_id
-- ===========================================================================
-- Com esta migration, todas as tabelas com hospital_id passam a ter escopo,
-- exceto as que NÃO DEVEM ter (motivo em cada uma):
--
--   company_portal_user_hospitals, doctor_portal_user_hospitals — definem o
--     escopo dos usuários de portal, que não estão em user_hospitals.
--   comm_campaigns — leitura por destinatário do portal.
--   deduction_run_locks — mecanismo de lock de service_role.
--   ai_checklist_cache, company_access_log — RLS ligada sem policy para
--     authenticated; já inacessíveis fora do service_role.
--   agreement_registration_events — escopada via can_access_agreement().
