
-- ============================================================
-- Fase A: auto-vínculo payments.batch_pattern_id
-- ============================================================

-- 1) Matcher: dado hospital + referência, devolve o padrão ativo que casa.
CREATE OR REPLACE FUNCTION public.match_batch_pattern(
  p_hospital_id uuid,
  p_reference text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_ref_norm text;
  v_id uuid;
BEGIN
  IF p_hospital_id IS NULL OR p_reference IS NULL OR btrim(p_reference) = '' THEN
    RETURN NULL;
  END IF;

  v_ref_norm := lower(unaccent(p_reference));

  -- Prioridade: alias mais longo primeiro (mais específico), depois code/label.
  SELECT pbp.id
    INTO v_id
  FROM public.payment_batch_patterns pbp
  LEFT JOIN LATERAL (
    SELECT max(length(a)) AS max_len
    FROM unnest(pbp.aliases) AS a
    WHERE v_ref_norm LIKE '%' || lower(unaccent(a)) || '%'
  ) al ON TRUE
  WHERE pbp.hospital_id = p_hospital_id
    AND pbp.active = true
    AND (
      al.max_len IS NOT NULL
      OR v_ref_norm LIKE '%' || lower(unaccent(pbp.code)) || '%'
      OR v_ref_norm LIKE '%' || lower(unaccent(pbp.label)) || '%'
    )
  ORDER BY
    COALESCE(al.max_len, 0) DESC,
    length(pbp.label) DESC
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- 2) Trigger em payments: tenta vincular sozinho quando não há padrão setado.
CREATE OR REPLACE FUNCTION public.tg_payments_auto_link_batch_pattern()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  IF NEW.batch_pattern_id IS NULL AND NEW.reference IS NOT NULL AND NEW.hospital_id IS NOT NULL THEN
    NEW.batch_pattern_id := public.match_batch_pattern(NEW.hospital_id, NEW.reference);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_auto_link_batch_pattern ON public.payments;
CREATE TRIGGER trg_payments_auto_link_batch_pattern
BEFORE INSERT OR UPDATE OF reference, hospital_id, batch_pattern_id
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_auto_link_batch_pattern();

-- 3) Backfill sob demanda no hospital ativo (últimos 12 meses)
CREATE OR REPLACE FUNCTION public.backfill_batch_pattern_links()
RETURNS TABLE(scanned integer, linked integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
  v_uid uuid := auth.uid();
  v_start date := (date_trunc('month', now()) - interval '12 months')::date;
  v_scanned integer := 0;
  v_linked integer := 0;
BEGIN
  IF v_hospital IS NULL THEN
    RAISE EXCEPTION 'no_active_hospital';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'diretor'::app_role)
    OR public.has_role(v_uid, 'analista'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SET LOCAL statement_timeout = '30s';

  WITH candidates AS (
    SELECT p.id, p.reference, p.hospital_id
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NULL
      AND p.reference IS NOT NULL
      AND p.competence_month >= v_start
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
  ),
  matched AS (
    SELECT c.id, public.match_batch_pattern(c.hospital_id, c.reference) AS pid
    FROM candidates c
  ),
  upd AS (
    UPDATE public.payments p
       SET batch_pattern_id = m.pid
      FROM matched m
     WHERE p.id = m.id
       AND m.pid IS NOT NULL
    RETURNING p.batch_pattern_id
  ),
  counts AS (
    SELECT
      (SELECT count(*) FROM matched)::int AS c_scanned,
      (SELECT count(*) FROM upd)::int      AS c_linked
  )
  SELECT c_scanned, c_linked INTO v_scanned, v_linked FROM counts;

  -- Atualiza métricas dos padrões impactados
  WITH agg AS (
    SELECT
      p.batch_pattern_id AS pid,
      count(DISTINCT to_char(p.competence_month, 'YYYY-MM'))::int AS ms,
      max(p.competence_month)::date AS last_seen,
      round(avg(NULLIF(p.bruto_total, 0))::numeric, 2) AS avg_b
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NOT NULL
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
    GROUP BY p.batch_pattern_id
  )
  UPDATE public.payment_batch_patterns pbp
     SET months_seen = agg.ms,
         last_seen_month = agg.last_seen,
         avg_bruto = agg.avg_b,
         updated_at = now()
    FROM agg
   WHERE pbp.id = agg.pid
     AND pbp.hospital_id = v_hospital;

  RETURN QUERY SELECT v_scanned, v_linked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_batch_pattern(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_batch_pattern_links() TO authenticated;
