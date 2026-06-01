
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_primary_hospital ON public.profiles(primary_hospital_id);

-- Função utilitária: define o hospital principal e cria vínculo em user_hospitals
-- (idempotente). Pode ser chamada pelo admin via RPC ou pela edge function.
CREATE OR REPLACE FUNCTION public.set_primary_hospital_for_user(
  _user_id uuid,
  _hospital_id uuid,
  _role public.app_role DEFAULT 'analista'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Apenas admin/diretor podem alterar hospital principal de outros usuários
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT public.is_global_role(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para definir hospital principal de outro usuário';
  END IF;

  IF _hospital_id IS NOT NULL THEN
    INSERT INTO public.user_hospitals (user_id, hospital_id, role)
    VALUES (_user_id, _hospital_id, _role)
    ON CONFLICT (user_id, hospital_id) DO NOTHING;
  END IF;

  UPDATE public.profiles
     SET primary_hospital_id = _hospital_id, updated_at = now()
   WHERE id = _user_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.set_primary_hospital_for_user(uuid, uuid, public.app_role) TO authenticated;
