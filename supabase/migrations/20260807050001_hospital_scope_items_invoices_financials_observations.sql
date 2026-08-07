-- payment_items, invoices, payment_company_financials e payment_observations
-- só tinham policies PERMISSIVE que checam papel (has_role), sem nenhuma
-- restrição de hospital_id — diferente de payments/payment_company_groups,
-- que já têm essas duas RESTRICTIVE desde 20260701180428. Qualquer
-- analista/validador/diretor/admin de QUALQUER hospital lia e escrevia
-- itens de pagamento, faturas, snapshots financeiros e observações de TODOS
-- os hospitais, não só do seu.
--
-- Mesmo padrão exato das duas tabelas irmãs. As 3 primeiras tabelas já têm
-- o trigger enforce_hospital_id_from_parent garantindo hospital_id herdado
-- corretamente do payment pai (nunca NULL na prática); invoices não tem esse
-- trigger, mas hospital_id já é NOT NULL desde 20260617154953 — o
-- "hospital_id IS NULL" nas policies abaixo é só a mesma válvula de escape
-- defensiva usada em payments/payment_company_groups, não uma bandeira aberta.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_items','invoices','payment_company_financials','payment_observations']
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
