CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- E-mail (login) é imutável via update da tabela profiles
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'O e-mail (login) não pode ser alterado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ID do perfil é imutável
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'O identificador do perfil não pode ser alterado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Quando um admin/diretor edita o perfil de OUTRO usuário,
  -- só pode alterar: full_name, phone, role_title, department, birth_date.
  -- Demais colunas (preferences) ficam protegidas.
  IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.id THEN
    IF NEW.preferences IS DISTINCT FROM OLD.preferences THEN
      RAISE EXCEPTION 'Administradores não podem alterar preferências de outros usuários'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_update_rules ON public.profiles;
CREATE TRIGGER profiles_enforce_update_rules
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_update_rules();