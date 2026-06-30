
CREATE OR REPLACE FUNCTION public._resolve_item_type_from_payment_type(_pt_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT it.id FROM public.payment_types pt
  JOIN public.item_types it ON it.code = pt.code WHERE pt.id = _pt_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._resolve_payment_type_from_item_type(_it_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pt.id FROM public.item_types it
  JOIN public.payment_types pt ON pt.code = it.code WHERE it.id = _it_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._resolve_payment_type_from_payment_model(_pm_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pt.id FROM public.payment_models pm
  JOIN public.payment_types pt ON pt.code = pm.code WHERE pm.id = _pm_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._resolve_payment_model_from_payment_type(_pt_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm.id FROM public.payment_types pt
  JOIN public.payment_models pm ON pm.code = pt.code WHERE pt.id = _pt_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sync_payment_items_type_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_type_id IS NOT NULL AND NEW.item_type_id IS NULL THEN
    NEW.item_type_id := public._resolve_item_type_from_payment_type(NEW.payment_type_id);
    IF NEW.item_type_source IS NULL THEN
      NEW.item_type_source := COALESCE(NEW.payment_type_source, 'inherit');
    END IF;
  END IF;
  IF NEW.item_type_id IS NOT NULL AND NEW.payment_type_id IS NULL THEN
    NEW.payment_type_id := public._resolve_payment_type_from_item_type(NEW.item_type_id);
    IF NEW.payment_type_source IS NULL THEN
      NEW.payment_type_source := COALESCE(NEW.item_type_source, 'inherit');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_payment_items_type_columns ON public.payment_items;
CREATE TRIGGER trg_sync_payment_items_type_columns
BEFORE INSERT OR UPDATE OF payment_type_id, item_type_id ON public.payment_items
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_items_type_columns();

CREATE OR REPLACE FUNCTION public.sync_payments_type_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_type_id IS NOT NULL AND NEW.payment_model_id IS NULL THEN
    NEW.payment_model_id := public._resolve_payment_model_from_payment_type(NEW.payment_type_id);
  END IF;
  IF NEW.payment_model_id IS NOT NULL AND NEW.payment_type_id IS NULL THEN
    NEW.payment_type_id := public._resolve_payment_type_from_payment_model(NEW.payment_model_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_payments_type_columns ON public.payments;
CREATE TRIGGER trg_sync_payments_type_columns
BEFORE INSERT OR UPDATE OF payment_type_id, payment_model_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_payments_type_columns();

CREATE OR REPLACE FUNCTION public.sync_rules_type_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_type_id IS NOT NULL AND NEW.payment_model_id IS NULL THEN
    NEW.payment_model_id := public._resolve_payment_model_from_payment_type(NEW.payment_type_id);
  END IF;
  IF NEW.payment_model_id IS NOT NULL AND NEW.payment_type_id IS NULL THEN
    NEW.payment_type_id := public._resolve_payment_type_from_payment_model(NEW.payment_model_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_rules_type_columns ON public.rules;
CREATE TRIGGER trg_sync_rules_type_columns
BEFORE INSERT OR UPDATE OF payment_type_id, payment_model_id ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.sync_rules_type_columns();

CREATE OR REPLACE VIEW public.v_legacy_payment_type_divergence AS
SELECT 'payment_items'::text AS table_name, pi.id AS row_id, pi.payment_id::text AS context_id,
       pi.payment_type_id AS legacy_id, pi.item_type_id AS new_id,
       pt.code AS legacy_code, it.code AS new_code
FROM public.payment_items pi
LEFT JOIN public.payment_types pt ON pt.id = pi.payment_type_id
LEFT JOIN public.item_types it ON it.id = pi.item_type_id
WHERE (pi.payment_type_id IS NOT NULL OR pi.item_type_id IS NOT NULL)
  AND (pi.payment_type_id IS NULL OR pi.item_type_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(it.code,''))
UNION ALL
SELECT 'payments', p.id, p.id::text, p.payment_type_id, p.payment_model_id, pt.code, pm.code
FROM public.payments p
LEFT JOIN public.payment_types pt ON pt.id = p.payment_type_id
LEFT JOIN public.payment_models pm ON pm.id = p.payment_model_id
WHERE (p.payment_type_id IS NOT NULL OR p.payment_model_id IS NOT NULL)
  AND (p.payment_type_id IS NULL OR p.payment_model_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(pm.code,''))
UNION ALL
SELECT 'rules', r.id, r.id::text, r.payment_type_id, r.payment_model_id, pt.code, pm.code
FROM public.rules r
LEFT JOIN public.payment_types pt ON pt.id = r.payment_type_id
LEFT JOIN public.payment_models pm ON pm.id = r.payment_model_id
WHERE (r.payment_type_id IS NOT NULL OR r.payment_model_id IS NOT NULL)
  AND (r.payment_type_id IS NULL OR r.payment_model_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(pm.code,''));

GRANT SELECT ON public.v_legacy_payment_type_divergence TO authenticated;
GRANT SELECT ON public.v_legacy_payment_type_divergence TO service_role;

UPDATE public.payment_items SET item_type_id = public._resolve_item_type_from_payment_type(payment_type_id)
WHERE payment_type_id IS NOT NULL AND item_type_id IS NULL;
UPDATE public.payment_items SET payment_type_id = public._resolve_payment_type_from_item_type(item_type_id)
WHERE item_type_id IS NOT NULL AND payment_type_id IS NULL;
UPDATE public.payments SET payment_model_id = public._resolve_payment_model_from_payment_type(payment_type_id)
WHERE payment_type_id IS NOT NULL AND payment_model_id IS NULL;
UPDATE public.payments SET payment_type_id = public._resolve_payment_type_from_payment_model(payment_model_id)
WHERE payment_model_id IS NOT NULL AND payment_type_id IS NULL;
UPDATE public.rules SET payment_model_id = public._resolve_payment_model_from_payment_type(payment_type_id)
WHERE payment_type_id IS NOT NULL AND payment_model_id IS NULL;
UPDATE public.rules SET payment_type_id = public._resolve_payment_type_from_payment_model(payment_model_id)
WHERE payment_model_id IS NOT NULL AND payment_type_id IS NULL;
