-- Fallback adicional em current_active_hospital():
-- Se não houver linha em user_active_hospital, tenta profiles.last_active_hospital_id
-- (mantido pela própria RPC set_active_hospital e pela seleção via UI).
-- Antes só existiam: (1) user_active_hospital → (2) auto-resolve por hospital único.
-- Usuários multi-hospital sem gravação no server ficavam com NULL e não conseguiam
-- inserir pagamentos por causa da policy active_hospital_scope.

CREATE OR REPLACE FUNCTION public.current_active_hospital()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hospital uuid;
  v_count int;
  v_only uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) valor explicitamente definido pelo servidor (sessão atual)
  SELECT hospital_id INTO v_hospital
    FROM public.user_active_hospital
   WHERE user_id = v_uid;

  IF v_hospital IS NOT NULL THEN
    RETURN v_hospital;
  END IF;

  -- 2) fallback: última escolha persistida no perfil (mantida por set_active_hospital
  --    e pela seleção manual). Cobre o caso em que a RPC falhou silenciosamente na
  --    carga inicial mas o usuário já tinha uma escolha válida antes.
  SELECT p.last_active_hospital_id INTO v_hospital
    FROM public.profiles p
   WHERE p.id = v_uid
     AND p.last_active_hospital_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.my_accessible_hospitals() h
       WHERE h.id = p.last_active_hospital_id
     );

  IF v_hospital IS NOT NULL THEN
    -- Sincroniza a sessão do servidor para as próximas chamadas.
    INSERT INTO public.user_active_hospital AS uah (user_id, hospital_id, updated_at)
    VALUES (v_uid, v_hospital, now())
    ON CONFLICT (user_id) DO UPDATE
      SET hospital_id = EXCLUDED.hospital_id,
          updated_at  = now();
    RETURN v_hospital;
  END IF;

  -- 3) auto-resolve: usuário com exatamente 1 hospital acessível
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

  -- 4) multi-hospital sem seleção → bloqueia
  RETURN NULL;
END;
$function$;