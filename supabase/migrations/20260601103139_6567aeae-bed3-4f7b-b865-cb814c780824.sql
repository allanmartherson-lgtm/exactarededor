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
  SELECT array_agg(dpu.doctor_id)
    INTO v_doctor_ids
    FROM public.doctor_portal_users dpu
   WHERE dpu.user_id = auth.uid()
     AND dpu.active = true;

  IF v_doctor_ids IS NULL OR array_length(v_doctor_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      dm.id,
      dm.doctor_id,
      dm.payment_id AS base_payment_id,
      dm.payment_item_id AS base_payment_item_id,
      dm.message,
      dm.author_name,
      dm.author_type,
      dm.read_by_doctor_at,
      dm.created_at,
      COALESCE(dm.payment_item_id::text, dm.payment_id::text) AS tkey
    FROM public.doctor_messages dm
    WHERE dm.doctor_id = ANY(v_doctor_ids)
      AND dm.payment_id IS NOT NULL
  ),
  agg AS (
    SELECT
      b.tkey,
      MAX(b.base_payment_id) AS agg_payment_id,
      MAX(b.base_payment_item_id) AS agg_payment_item_id,
      MAX(b.created_at) AS last_at,
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (
        WHERE b.author_type <> 'medico'
          AND b.read_by_doctor_at IS NULL
      )::integer AS unread
    FROM base b
    GROUP BY b.tkey
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
    a.tkey AS thread_key,
    a.agg_payment_id AS payment_id,
    a.agg_payment_item_id AS payment_item_id,
    p.reference AS payment_reference,
    p.competence_month,
    pi.procedure_code,
    pi.procedure_name,
    l.message AS last_message,
    l.author_name AS last_author_name,
    l.author_type AS last_author_type,
    a.last_at AS last_message_at,
    a.unread AS unread_count,
    a.total AS total_count
  FROM agg a
  LEFT JOIN public.payments p
    ON p.id = a.agg_payment_id
  LEFT JOIN public.payment_items pi
    ON pi.id = a.agg_payment_item_id
  LEFT JOIN last_msg l
    ON l.tkey = a.tkey
  ORDER BY a.last_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_threads() TO authenticated;