-- Onda 3: Mensagens agrupadas + realtime no portal do médico

-- 1) RPC: lista threads agrupadas por pagamento/item do médico autenticado
CREATE OR REPLACE FUNCTION public.get_portal_threads()
RETURNS TABLE (
  thread_key TEXT,
  payment_id UUID,
  payment_item_id UUID,
  payment_reference TEXT,
  competence_month TEXT,
  procedure_code TEXT,
  procedure_name TEXT,
  last_message TEXT,
  last_author_name TEXT,
  last_author_type TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_ids UUID[];
BEGIN
  SELECT array_agg(doctor_id)
    INTO v_doctor_ids
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true;

  IF v_doctor_ids IS NULL OR array_length(v_doctor_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      dm.*,
      COALESCE(dm.payment_item_id::TEXT, dm.payment_id::TEXT) AS tkey
    FROM doctor_messages dm
    WHERE dm.doctor_id = ANY(v_doctor_ids)
      AND dm.payment_id IS NOT NULL
  ),
  agg AS (
    SELECT
      tkey,
      MAX(payment_id) AS pid,
      MAX(payment_item_id) AS piid,
      MAX(created_at) AS last_at,
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (
        WHERE author_type <> 'medico' AND read_by_doctor_at IS NULL
      )::INTEGER AS unread
    FROM base
    GROUP BY tkey
  ),
  last_msg AS (
    SELECT DISTINCT ON (b.tkey)
      b.tkey,
      b.message,
      b.author_name,
      b.author_type,
      b.created_at
    FROM base b
    ORDER BY b.tkey, b.created_at DESC
  )
  SELECT
    a.tkey,
    a.pid,
    a.piid,
    p.reference,
    p.competence_month,
    pi.procedure_code,
    pi.procedure_name,
    l.message,
    l.author_name,
    l.author_type,
    a.last_at,
    a.unread,
    a.total
  FROM agg a
  LEFT JOIN payments p ON p.id = a.pid
  LEFT JOIN payment_items pi ON pi.id = a.piid
  LEFT JOIN last_msg l ON l.tkey = a.tkey
  ORDER BY a.last_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_threads() TO authenticated;

-- 2) RPC: lista mensagens de uma thread específica
CREATE OR REPLACE FUNCTION public.get_portal_thread_messages(
  p_payment_id UUID,
  p_payment_item_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  message TEXT,
  author_name TEXT,
  author_type TEXT,
  created_at TIMESTAMPTZ,
  read_by_doctor_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_ids UUID[];
BEGIN
  SELECT array_agg(doctor_id) INTO v_doctor_ids
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true;

  IF v_doctor_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT dm.id, dm.message, dm.author_name, dm.author_type,
         dm.created_at, dm.read_by_doctor_at
  FROM doctor_messages dm
  WHERE dm.doctor_id = ANY(v_doctor_ids)
    AND dm.payment_id = p_payment_id
    AND (
      (p_payment_item_id IS NULL AND dm.payment_item_id IS NULL)
      OR dm.payment_item_id = p_payment_item_id
    )
  ORDER BY dm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_thread_messages(UUID, UUID) TO authenticated;

-- 3) RPC: posta nova mensagem do médico
CREATE OR REPLACE FUNCTION public.post_portal_message(
  p_payment_id UUID,
  p_message TEXT,
  p_payment_item_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_id UUID;
  v_author_name TEXT;
  v_new_id UUID;
BEGIN
  SELECT dpu.doctor_id INTO v_doctor_id
    FROM doctor_portal_users dpu
   WHERE dpu.user_id = auth.uid() AND dpu.active = true
   LIMIT 1;

  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não vinculado a médico';
  END IF;

  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'Mensagem vazia';
  END IF;

  SELECT COALESCE(full_name, 'Médico') INTO v_author_name
    FROM doctors WHERE id = v_doctor_id;

  INSERT INTO doctor_messages (
    doctor_id, payment_id, payment_item_id,
    message, author_name, author_type, author_user_id
  ) VALUES (
    v_doctor_id, p_payment_id, p_payment_item_id,
    trim(p_message), v_author_name, 'medico', auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_portal_message(UUID, TEXT, UUID) TO authenticated;

-- 4) RPC: marca thread como lida pelo médico
CREATE OR REPLACE FUNCTION public.mark_portal_thread_read(
  p_payment_id UUID,
  p_payment_item_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_ids UUID[];
  v_count INTEGER;
BEGIN
  SELECT array_agg(doctor_id) INTO v_doctor_ids
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true;

  IF v_doctor_ids IS NULL THEN RETURN 0; END IF;

  UPDATE doctor_messages
     SET read_by_doctor_at = now()
   WHERE doctor_id = ANY(v_doctor_ids)
     AND payment_id = p_payment_id
     AND (
       (p_payment_item_id IS NULL AND payment_item_id IS NULL)
       OR payment_item_id = p_payment_item_id
     )
     AND author_type <> 'medico'
     AND read_by_doctor_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_portal_thread_read(UUID, UUID) TO authenticated;

-- 5) RPC: contador global de não lidas (badge)
CREATE OR REPLACE FUNCTION public.get_portal_unread_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_ids UUID[];
  v_count INTEGER;
BEGIN
  SELECT array_agg(doctor_id) INTO v_doctor_ids
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true;

  IF v_doctor_ids IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
    FROM doctor_messages
   WHERE doctor_id = ANY(v_doctor_ids)
     AND author_type <> 'medico'
     AND read_by_doctor_at IS NULL;

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_unread_count() TO authenticated;

-- 6) Habilita realtime na tabela doctor_messages
ALTER TABLE public.doctor_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_messages;
