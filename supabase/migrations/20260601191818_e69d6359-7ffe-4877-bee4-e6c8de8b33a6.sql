-- 1) Persistência server-side do último hospital ativo (volta automaticamente em outro device)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL;

-- 2) Tabela de auditoria de troca de hospital
CREATE TABLE IF NOT EXISTS public.hospital_switch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  old_hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  new_hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  old_hospital_name text,
  new_hospital_name text,
  user_agent text,
  switched_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.hospital_switch_log TO authenticated;
GRANT ALL ON public.hospital_switch_log TO service_role;

ALTER TABLE public.hospital_switch_log ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas os próprios eventos
CREATE POLICY "user sees own switch log"
ON public.hospital_switch_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admin/diretor veem tudo (rastreabilidade)
CREATE POLICY "admin sees all switch log"
ON public.hospital_switch_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

-- Inserção via RPC (security definer) — bloqueamos INSERT direto sem dono correto
CREATE POLICY "authenticated insert own switch log"
ON public.hospital_switch_log
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_hospital_switch_log_user ON public.hospital_switch_log(user_id, switched_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_switch_log_when ON public.hospital_switch_log(switched_at DESC);

-- 3) RPC que registra a troca + atualiza last_active_hospital_id em uma chamada
CREATE OR REPLACE FUNCTION public.log_hospital_switch(
  p_new_hospital_id uuid,
  p_old_hospital_id uuid DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_old_name text;
  v_new_name text;
  v_log_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Defesa: usuário só pode logar troca para hospital que ele realmente acessa
  IF NOT EXISTS (
    SELECT 1 FROM public.my_accessible_hospitals() h WHERE h.id = p_new_hospital_id
  ) THEN
    RAISE EXCEPTION 'hospital not accessible to user';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT name INTO v_new_name FROM public.hospitals WHERE id = p_new_hospital_id;
  IF p_old_hospital_id IS NOT NULL THEN
    SELECT name INTO v_old_name FROM public.hospitals WHERE id = p_old_hospital_id;
  END IF;

  INSERT INTO public.hospital_switch_log (
    user_id, user_email, old_hospital_id, new_hospital_id,
    old_hospital_name, new_hospital_name, user_agent
  ) VALUES (
    v_uid, v_email, p_old_hospital_id, p_new_hospital_id,
    v_old_name, v_new_name, p_user_agent
  ) RETURNING id INTO v_log_id;

  UPDATE public.profiles
     SET last_active_hospital_id = p_new_hospital_id
   WHERE id = v_uid;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_hospital_switch(uuid, uuid, text) TO authenticated;