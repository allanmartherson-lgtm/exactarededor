CREATE OR REPLACE FUNCTION public.sync_payment_company_group(
  p_payment_id uuid,
  p_company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_total numeric;
  v_name text;
  v_hospital_id uuid;
  v_mode public.payment_analysis_mode;
  v_updated int;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::int, coalesce(sum(gross_amount), 0), max(company_name)
    INTO v_count, v_total, v_name
    FROM payment_items
   WHERE payment_id = p_payment_id AND company_id = p_company_id;

  SELECT hospital_id, analysis_mode INTO v_hospital_id, v_mode
    FROM payments WHERE id = p_payment_id;

  IF v_hospital_id IS NULL THEN
    SELECT hospital_id INTO v_hospital_id
      FROM payment_items
     WHERE payment_id = p_payment_id AND hospital_id IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_count = 0 THEN
    UPDATE payment_company_groups
       SET items_count = 0,
           total_amount = 0,
           bruto_total = 0,
           confeccao_status = CASE WHEN v_mode = 'confeccao' THEN confeccao_status ELSE NULL END,
           updated_at = now()
     WHERE payment_id = p_payment_id AND company_id = p_company_id;
    RETURN;
  END IF;

  -- Tenta UPDATE primeiro (não impacta confeccao_status válido quando em modo confecção)
  UPDATE payment_company_groups
     SET items_count = v_count,
         total_amount = v_total,
         bruto_total = v_total,
         company_name = COALESCE(company_name, v_name),
         confeccao_status = CASE
           WHEN v_mode = 'confeccao' THEN confeccao_status
           ELSE NULL  -- limpa estado obsoleto se pagamento saiu do modo confecção
         END,
         updated_at = now()
   WHERE payment_id = p_payment_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN RETURN; END IF;

  -- Não existia: precisa de hospital_id para criar
  IF v_hospital_id IS NULL THEN RETURN; END IF;

  INSERT INTO payment_company_groups (
    payment_id, hospital_id, company_id, company_name,
    items_count, total_amount, bruto_total, status,
    confeccao_status
  )
  VALUES (
    p_payment_id, v_hospital_id, p_company_id, coalesce(v_name, '—'),
    v_count, v_total, v_total, 'revisao_analista',
    CASE WHEN v_mode = 'confeccao' THEN 'em_confeccao'::public.confeccao_status ELSE NULL END
  );
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_company_groups_payment_company_uniq
  ON public.payment_company_groups (payment_id, company_id);

CREATE OR REPLACE FUNCTION public.tg_sync_company_groups_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    FOR r IN SELECT DISTINCT payment_id, company_id FROM new_rows
              WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
    LOOP PERFORM public.sync_payment_company_group(r.payment_id, r.company_id); END LOOP;
  END IF;
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    FOR r IN SELECT DISTINCT payment_id, company_id FROM old_rows
              WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
    LOOP PERFORM public.sync_payment_company_group(r.payment_id, r.company_id); END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_company_groups_ins ON public.payment_items;
DROP TRIGGER IF EXISTS trg_sync_company_groups_upd ON public.payment_items;
DROP TRIGGER IF EXISTS trg_sync_company_groups_del ON public.payment_items;

CREATE TRIGGER trg_sync_company_groups_ins
AFTER INSERT ON public.payment_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_sync_company_groups_from_items();

CREATE TRIGGER trg_sync_company_groups_upd
AFTER UPDATE ON public.payment_items
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_sync_company_groups_from_items();

CREATE TRIGGER trg_sync_company_groups_del
AFTER DELETE ON public.payment_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_sync_company_groups_from_items();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT pi.payment_id, pi.company_id
      FROM payment_items pi
     WHERE pi.payment_id IS NOT NULL AND pi.company_id IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.sync_payment_company_group(r.payment_id, r.company_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sync skipped for payment=% company=%: %', r.payment_id, r.company_id, SQLERRM;
    END;
  END LOOP;
END $$;