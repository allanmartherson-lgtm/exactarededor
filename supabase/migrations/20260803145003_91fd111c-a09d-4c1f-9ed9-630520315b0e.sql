-- 1) profiles: bloquear auto-elevação de campos privilegiados
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'O e-mail (login) não pode ser alterado' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'O identificador do perfil não pode ser alterado' USING ERRCODE = 'check_violation';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.id THEN
    IF NEW.preferences IS DISTINCT FROM OLD.preferences THEN
      RAISE EXCEPTION 'Administradores não podem alterar preferências de outros usuários'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Campos privilegiados: só admin/diretor podem alterar. Impede auto-elevação
  -- quando o próprio usuário edita seu perfil pelo app.
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
               OR public.has_role(auth.uid(), 'diretor'::app_role);
    IF NOT v_is_admin THEN
      IF NEW.is_senior IS DISTINCT FROM OLD.is_senior
         OR NEW.active IS DISTINCT FROM OLD.active
         OR NEW.primary_hospital_id IS DISTINCT FROM OLD.primary_hospital_id
         OR NEW.cpf IS DISTINCT FROM OLD.cpf THEN
        RAISE EXCEPTION 'Você não pode alterar campos privilegiados do seu perfil'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2) internal_notifications: escrita apenas pelo backend (service_role)
REVOKE INSERT, DELETE ON public.internal_notifications FROM authenticated, anon;
GRANT SELECT, UPDATE ON public.internal_notifications TO authenticated;
GRANT ALL ON public.internal_notifications TO service_role;

DROP POLICY IF EXISTS "service role manages notifications" ON public.internal_notifications;
CREATE POLICY "service role manages notifications" ON public.internal_notifications
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3) deduction_run_locks: política restrita ao role service_role
REVOKE ALL ON public.deduction_run_locks FROM authenticated, anon;
GRANT ALL ON public.deduction_run_locks TO service_role;

DROP POLICY IF EXISTS "service_role manages locks" ON public.deduction_run_locks;
CREATE POLICY "service_role manages locks" ON public.deduction_run_locks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);