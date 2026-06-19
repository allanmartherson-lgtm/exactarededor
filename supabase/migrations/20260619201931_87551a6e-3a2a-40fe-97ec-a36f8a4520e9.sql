-- Bloqueia explicitamente authenticated e anon em realtime.messages.
-- O app não usa Broadcast/Presence — só postgres_changes, que lê do WAL e
-- não passa por essa tabela. Service_role mantém acesso total para o
-- próprio serviço Realtime continuar operando.

DO $$
BEGIN
  -- Deny all para authenticated
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'realtime.messages'::regclass
      AND polname = 'deny_all_authenticated'
  ) THEN
    EXECUTE $p$
      CREATE POLICY deny_all_authenticated ON realtime.messages
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false)
    $p$;
  END IF;

  -- Deny all para anon
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'realtime.messages'::regclass
      AND polname = 'deny_all_anon'
  ) THEN
    EXECUTE $p$
      CREATE POLICY deny_all_anon ON realtime.messages
      AS RESTRICTIVE
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false)
    $p$;
  END IF;
END $$;