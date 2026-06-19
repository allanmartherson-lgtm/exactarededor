
-- 1) Tabela server-side com o hospital ativo de cada usuário
CREATE TABLE IF NOT EXISTS public.user_active_hospital (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_active_hospital TO authenticated;
GRANT ALL ON public.user_active_hospital TO service_role;

ALTER TABLE public.user_active_hospital ENABLE ROW LEVEL SECURITY;

-- Usuário lê apenas a própria linha. Escrita só via RPC SECURITY DEFINER.
DROP POLICY IF EXISTS uah_select_self ON public.user_active_hospital;
CREATE POLICY uah_select_self
  ON public.user_active_hospital
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) RPC: define o hospital ativo do usuário corrente (com validação de acesso)
CREATE OR REPLACE FUNCTION public.set_active_hospital(p_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_hospital_id IS NULL THEN
    DELETE FROM public.user_active_hospital WHERE user_id = v_uid;
    RETURN;
  END IF;

  -- Valida que o hospital é realmente acessível pelo usuário.
  IF NOT EXISTS (
    SELECT 1 FROM public.my_accessible_hospitals() h WHERE h.id = p_hospital_id
  ) THEN
    RAISE EXCEPTION 'hospital not accessible to user';
  END IF;

  INSERT INTO public.user_active_hospital AS uah (user_id, hospital_id, updated_at)
  VALUES (v_uid, p_hospital_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET hospital_id = EXCLUDED.hospital_id,
        updated_at  = now();

  -- Mantém `last_active_hospital_id` em sincronia para o auto-resolve no load.
  UPDATE public.profiles
     SET last_active_hospital_id = p_hospital_id,
         updated_at = now()
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_hospital(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_hospital(uuid) TO authenticated;

-- 3) current_active_hospital(): lê do banco, sem fallback para header
CREATE OR REPLACE FUNCTION public.current_active_hospital()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hospital uuid;
  v_count int;
  v_only uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) valor explicitamente definido pelo servidor
  SELECT hospital_id INTO v_hospital
    FROM public.user_active_hospital
   WHERE user_id = v_uid;

  IF v_hospital IS NOT NULL THEN
    RETURN v_hospital;
  END IF;

  -- 2) auto-resolve: usuário com exatamente 1 hospital acessível
  SELECT count(*), max(h_id)
    INTO v_count, v_only
    FROM (
      SELECT h.id AS h_id
        FROM public.hospitals h
       WHERE h.active = true
         AND (
           public.is_global_role(v_uid)
           OR h.id = ANY(public.user_hospital_ids(v_uid))
         )
    ) s;

  IF v_count = 1 THEN
    RETURN v_only;
  END IF;

  -- 3) multi-hospital sem seleção → bloqueia
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.current_active_hospital() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_active_hospital() TO authenticated, anon, service_role;

-- 4) Backfill: hidrata user_active_hospital com last_active_hospital_id já validado
INSERT INTO public.user_active_hospital (user_id, hospital_id, updated_at)
SELECT p.id, p.last_active_hospital_id, now()
  FROM public.profiles p
 WHERE p.last_active_hospital_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.hospitals h
      WHERE h.id = p.last_active_hospital_id AND h.active = true
   )
ON CONFLICT (user_id) DO NOTHING;
