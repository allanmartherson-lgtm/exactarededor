-- Embute o escopo de hospital/estado nas políticas PERMISSIVE de escrita que hoje
-- dependem exclusivamente da camada RESTRICTIVE para isolamento por hospital.
--
-- Segurança/equivalência: todas as políticas afetadas e todas as políticas
-- RESTRICTIVE de escopo são TO authenticated, e a camada restritiva já é
-- aplicada em conjunção (AND) a essas mesmas políticas. Logo, embutir o mesmo
-- predicado na cláusula permissiva é logicamente equivalente (A AND R ≡ A AND R)
-- e não altera comportamento — apenas remove a dependência exclusiva da
-- camada restritiva, que é mantida como defesa em profundidade.

-- Evita deadlock com sessões concorrentes: falha rápido e tenta de novo.
SET LOCAL lock_timeout = '3s';

DO $do$
DECLARE
  pol            RECORD;
  scope_using    TEXT;
  scope_check    TEXT;
  new_using      TEXT;
  new_check      TEXT;
  stmt           TEXT;
  changed        INT := 0;
  attempt        INT;
  ok             BOOLEAN;
BEGIN
  FOR pol IN
    WITH restrictive_tables AS (
      SELECT DISTINCT tablename
      FROM pg_policies
      WHERE schemaname = 'public'
        AND permissive = 'RESTRICTIVE'
        AND (qual ILIKE '%hospital%' OR qual ILIKE '%state_scope%')
    )
    SELECT p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    FROM pg_policies p
    JOIN restrictive_tables rt ON rt.tablename = p.tablename
    WHERE p.schemaname = 'public'
      AND p.permissive = 'PERMISSIVE'
      AND p.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND p.roles::text = '{authenticated}'
      AND NOT (COALESCE(p.qual, '') ILIKE '%hospital%' OR COALESCE(p.qual, '') ILIKE '%state_scope%')
      AND NOT (COALESCE(p.with_check, '') ILIKE '%hospital%' OR COALESCE(p.with_check, '') ILIKE '%state_scope%')
    ORDER BY p.tablename, p.policyname
  LOOP
    -- Predicado de escopo = conjunção das políticas RESTRICTIVE de hospital/estado
    -- aplicáveis ao mesmo comando na mesma tabela.
    SELECT string_agg(DISTINCT '(' || r.qual || ')', ' AND '),
           string_agg(DISTINCT '(' || COALESCE(r.with_check, r.qual) || ')', ' AND ')
      INTO scope_using, scope_check
    FROM pg_policies r
    WHERE r.schemaname = 'public'
      AND r.tablename = pol.tablename
      AND r.permissive = 'RESTRICTIVE'
      AND r.roles::text = '{authenticated}'
      AND (r.cmd = 'ALL' OR r.cmd = pol.cmd)
      AND r.qual IS NOT NULL
      AND (r.qual ILIKE '%hospital%' OR r.qual ILIKE '%state_scope%');

    IF scope_using IS NULL THEN
      CONTINUE;
    END IF;

    new_using := NULL;
    new_check := NULL;

    IF pol.qual IS NOT NULL THEN
      new_using := '(' || pol.qual || ') AND (' || scope_using || ')';
    END IF;

    IF pol.with_check IS NOT NULL THEN
      new_check := '(' || pol.with_check || ') AND (' || COALESCE(scope_check, scope_using) || ')';
    END IF;

    IF new_using IS NULL AND new_check IS NULL THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', pol.policyname, pol.tablename);
    IF new_using IS NOT NULL THEN
      stmt := stmt || ' USING (' || new_using || ')';
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || ' WITH CHECK (' || new_check || ')';
    END IF;

    attempt := 0;
    ok := false;
    WHILE NOT ok AND attempt < 10 LOOP
      attempt := attempt + 1;
      BEGIN
        EXECUTE stmt;
        ok := true;
      EXCEPTION
        WHEN lock_not_available OR deadlock_detected THEN
          PERFORM pg_sleep(0.5);
      END;
    END LOOP;

    IF NOT ok THEN
      RAISE EXCEPTION 'Não foi possível obter lock para a política % em %', pol.policyname, pol.tablename;
    END IF;

    changed := changed + 1;
  END LOOP;

  RAISE NOTICE 'Políticas de escrita com escopo embutido: %', changed;
END
$do$;