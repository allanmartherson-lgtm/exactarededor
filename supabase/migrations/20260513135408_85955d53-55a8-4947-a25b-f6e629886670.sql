CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TYPE public.item_ai_status ADD VALUE IF NOT EXISTS 'erro_duplicidade_pagamento';

CREATE OR REPLACE FUNCTION public.norm_for_hash(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    lower(translate(coalesce(s, ''),
      'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn'
    )),
    '[^a-z0-9]+', '', 'g'
  )
$$;

CREATE OR REPLACE FUNCTION public.compute_payment_item_hash(
  _attendance      text,
  _agreement       text,
  _procedure_date  timestamptz,
  _procedure_code  text,
  _doctor_role     text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN coalesce(public.norm_for_hash(_attendance),'') = ''
      OR coalesce(public.norm_for_hash(_procedure_code),'') = ''
      OR _procedure_date IS NULL
    THEN NULL
    ELSE encode(
      extensions.digest(
        (
          public.norm_for_hash(_attendance)     || '|' ||
          public.norm_for_hash(_agreement)      || '|' ||
          to_char(_procedure_date::date, 'YYYY-MM-DD') || '|' ||
          public.norm_for_hash(_procedure_code) || '|' ||
          public.norm_for_hash(_doctor_role)
        )::bytea,
        'sha256'::text
      ),
      'hex'
    )
  END
$$;

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS item_hash text;

CREATE INDEX IF NOT EXISTS idx_payment_items_item_hash
  ON public.payment_items (item_hash)
  WHERE item_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_compute_item_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.item_hash := public.compute_payment_item_hash(
    NEW.attendance_number,
    NEW.agreement_text,
    NEW.procedure_date,
    NEW.procedure_code,
    NEW.doctor_role
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_compute_hash_ins ON public.payment_items;
CREATE TRIGGER trg_payment_items_compute_hash_ins
  BEFORE INSERT ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_item_hash();

DROP TRIGGER IF EXISTS trg_payment_items_compute_hash_upd ON public.payment_items;
CREATE TRIGGER trg_payment_items_compute_hash_upd
  BEFORE UPDATE OF attendance_number, agreement_text, procedure_date, procedure_code, doctor_role
  ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_item_hash();

DO $backfill$
DECLARE
  v_hashable    int;
  v_filled_run1 int;
  v_filled_run2 int;
  v_with_hash   int;
BEGIN
  SELECT count(*) INTO v_hashable
  FROM public.payment_items
  WHERE attendance_number IS NOT NULL
    AND procedure_code IS NOT NULL
    AND procedure_date IS NOT NULL;

  RAISE NOTICE '[2B backfill] hasheáveis: %', v_hashable;

  WITH upd AS (
    UPDATE public.payment_items pi
       SET item_hash = public.compute_payment_item_hash(
         pi.attendance_number, pi.agreement_text, pi.procedure_date,
         pi.procedure_code, pi.doctor_role
       )
     WHERE pi.item_hash IS DISTINCT FROM public.compute_payment_item_hash(
         pi.attendance_number, pi.agreement_text, pi.procedure_date,
         pi.procedure_code, pi.doctor_role
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_filled_run1 FROM upd;
  RAISE NOTICE '[2B backfill] run #1 atualizou: %', v_filled_run1;

  WITH upd AS (
    UPDATE public.payment_items pi
       SET item_hash = public.compute_payment_item_hash(
         pi.attendance_number, pi.agreement_text, pi.procedure_date,
         pi.procedure_code, pi.doctor_role
       )
     WHERE pi.item_hash IS DISTINCT FROM public.compute_payment_item_hash(
         pi.attendance_number, pi.agreement_text, pi.procedure_date,
         pi.procedure_code, pi.doctor_role
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_filled_run2 FROM upd;
  RAISE NOTICE '[2B backfill] run #2 atualizou: % (esperado 0)', v_filled_run2;

  IF v_filled_run2 <> 0 THEN
    RAISE EXCEPTION '[2B backfill] FALHA idempotência: run #2 = %', v_filled_run2;
  END IF;

  SELECT count(*) INTO v_with_hash FROM public.payment_items WHERE item_hash IS NOT NULL;
  RAISE NOTICE '[2B backfill] itens com hash final: %', v_with_hash;

  IF v_with_hash <> v_hashable THEN
    RAISE EXCEPTION '[2B backfill] FALHA cobertura: hasheáveis=%, com_hash=%', v_hashable, v_with_hash;
  END IF;
END;
$backfill$;

CREATE OR REPLACE FUNCTION public.apply_duplicate_override(
  _item_id uuid,
  _justification text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing jsonb;
  v_new_findings jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_actor, 'diretor'::app_role) THEN
    RAISE EXCEPTION 'Apenas perfil diretor pode autorizar override de duplicidade' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(_justification),'') = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória' USING ERRCODE = '22023';
  END IF;

  SELECT ai_findings INTO v_existing FROM public.payment_items WHERE id = _item_id;
  IF v_existing IS NULL THEN
    v_existing := '{}'::jsonb;
  END IF;

  v_new_findings := jsonb_set(
    v_existing,
    '{duplicate_detection,override}',
    jsonb_build_object(
      'by', v_actor,
      'at', to_jsonb(now()),
      'justification', _justification
    ),
    true
  );
  v_new_findings := jsonb_set(v_new_findings, '{duplicate_detection,status}',
    to_jsonb('override_applied'::text), true);

  UPDATE public.payment_items
     SET ai_findings = v_new_findings,
         ai_status = 'pendente'::item_ai_status
   WHERE id = _item_id;

  INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
  VALUES (v_actor, 'payment_item', _item_id, 'duplicate_override',
          jsonb_build_object('justification', _justification));

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'by', v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_duplicate_override(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_override(uuid, text) TO authenticated;