CREATE OR REPLACE FUNCTION public.current_active_hospital()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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

  SELECT hospital_id INTO v_hospital
    FROM public.user_active_hospital
   WHERE user_id = v_uid;

  IF v_hospital IS NOT NULL THEN
    RETURN v_hospital;
  END IF;

  SELECT p.last_active_hospital_id INTO v_hospital
    FROM public.profiles p
   WHERE p.id = v_uid
     AND p.last_active_hospital_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.my_accessible_hospitals() h
       WHERE h.id = p.last_active_hospital_id
     );

  IF v_hospital IS NOT NULL THEN
    INSERT INTO public.user_active_hospital AS uah (user_id, hospital_id, updated_at)
    VALUES (v_uid, v_hospital, now())
    ON CONFLICT (user_id) DO UPDATE
      SET hospital_id = EXCLUDED.hospital_id,
          updated_at  = now();
    RETURN v_hospital;
  END IF;

  -- 3) auto-resolve: usuário com exatamente 1 hospital acessível.
  -- Usa count + min sobre texto porque não existe agregado max(uuid) no Postgres;
  -- a versão anterior quebrava com "function max(uuid) does not exist" justamente
  -- no caso de usuário sem hospital acessível.
  SELECT count(*), min(s.h_id::text)
    INTO v_count, v_hospital
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
    RETURN v_hospital;
  END IF;

  -- 4) nenhum hospital acessível OU multi-hospital sem seleção → sem escopo
  RETURN NULL;
END;
$function$;