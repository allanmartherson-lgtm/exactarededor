-- =====================================================
-- D3.e.3 — Add canonical columns + backfill + forward/backward sync triggers
-- =====================================================

-- 1) NEW COLUMNS ---------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS mixed_parecer_item_type_id uuid
    REFERENCES public.item_types(id) ON DELETE SET NULL;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_item_type_id uuid
    REFERENCES public.item_types(id) ON DELETE SET NULL;

ALTER TABLE public.company_financial_adjustments
  ADD COLUMN IF NOT EXISTS payment_model_ids uuid[];

-- 2) BACKFILL ------------------------------------------------------
-- payments.mixed_parecer_item_type_id  ← item_types via code
UPDATE public.payments p
SET mixed_parecer_item_type_id = it.id
FROM public.payment_types pt
JOIN public.item_types it ON it.code = pt.code
WHERE p.mixed_parecer_payment_type_id = pt.id
  AND p.mixed_parecer_item_type_id IS NULL;

-- companies.default_item_type_id  ← item_types via code (0 rows hoje, executa por garantia)
UPDATE public.companies c
SET default_item_type_id = it.id
FROM public.payment_types pt
JOIN public.item_types it ON it.code = pt.code
WHERE c.default_payment_type_id = pt.id
  AND c.default_item_type_id IS NULL;

-- company_financial_adjustments.payment_model_ids  ← map cada id via code,
-- dropa IDs órfãos (item-type-only). Opção 2: array vazio se nenhum mapear.
UPDATE public.company_financial_adjustments cfa
SET payment_model_ids = (
  SELECT COALESCE(array_agg(pm.id), ARRAY[]::uuid[])
  FROM unnest(cfa.payment_type_ids) AS leg_id
  JOIN public.payment_types pt ON pt.id = leg_id
  JOIN public.payment_models pm ON pm.code = pt.code
)
WHERE cfa.payment_type_ids IS NOT NULL
  AND cfa.payment_model_ids IS NULL;

-- 3) SYNC FUNCTIONS / TRIGGERS ------------------------------------

-- payments.mixed_parecer_*  bidirectional
CREATE OR REPLACE FUNCTION public.sync_payments_mixed_parecer_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.mixed_parecer_payment_type_id IS NOT NULL AND NEW.mixed_parecer_item_type_id IS NULL THEN
    SELECT it.id INTO NEW.mixed_parecer_item_type_id
    FROM public.payment_types pt
    JOIN public.item_types it ON it.code = pt.code
    WHERE pt.id = NEW.mixed_parecer_payment_type_id;
  ELSIF NEW.mixed_parecer_item_type_id IS NOT NULL AND NEW.mixed_parecer_payment_type_id IS NULL THEN
    SELECT pt.id INTO NEW.mixed_parecer_payment_type_id
    FROM public.item_types it
    JOIN public.payment_types pt ON pt.code = it.code
    WHERE it.id = NEW.mixed_parecer_item_type_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payments_mixed_parecer_columns ON public.payments;
CREATE TRIGGER trg_sync_payments_mixed_parecer_columns
BEFORE INSERT OR UPDATE OF mixed_parecer_payment_type_id, mixed_parecer_item_type_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_payments_mixed_parecer_columns();

-- companies.default_*  bidirectional
CREATE OR REPLACE FUNCTION public.sync_companies_default_type_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.default_payment_type_id IS NOT NULL AND NEW.default_item_type_id IS NULL THEN
    SELECT it.id INTO NEW.default_item_type_id
    FROM public.payment_types pt
    JOIN public.item_types it ON it.code = pt.code
    WHERE pt.id = NEW.default_payment_type_id;
  ELSIF NEW.default_item_type_id IS NOT NULL AND NEW.default_payment_type_id IS NULL THEN
    SELECT pt.id INTO NEW.default_payment_type_id
    FROM public.item_types it
    JOIN public.payment_types pt ON pt.code = it.code
    WHERE it.id = NEW.default_item_type_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_companies_default_type_columns ON public.companies;
CREATE TRIGGER trg_sync_companies_default_type_columns
BEFORE INSERT OR UPDATE OF default_payment_type_id, default_item_type_id ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.sync_companies_default_type_columns();

-- company_financial_adjustments  bidirectional para arrays
CREATE OR REPLACE FUNCTION public.sync_cfa_payment_model_ids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- legacy → novo: mapeia payment_type_ids para payment_model_ids (dropa órfãos)
  IF NEW.payment_type_ids IS NOT NULL AND NEW.payment_model_ids IS NULL THEN
    NEW.payment_model_ids := (
      SELECT COALESCE(array_agg(pm.id), ARRAY[]::uuid[])
      FROM unnest(NEW.payment_type_ids) AS leg_id
      JOIN public.payment_types pt ON pt.id = leg_id
      JOIN public.payment_models pm ON pm.code = pt.code
    );
  END IF;
  -- novo → legacy: mapeia payment_model_ids para payment_type_ids
  IF NEW.payment_model_ids IS NOT NULL AND NEW.payment_type_ids IS NULL THEN
    NEW.payment_type_ids := (
      SELECT COALESCE(array_agg(pt.id), ARRAY[]::uuid[])
      FROM unnest(NEW.payment_model_ids) AS new_id
      JOIN public.payment_models pm ON pm.id = new_id
      JOIN public.payment_types pt ON pt.code = pm.code
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cfa_payment_model_ids ON public.company_financial_adjustments;
CREATE TRIGGER trg_sync_cfa_payment_model_ids
BEFORE INSERT OR UPDATE OF payment_type_ids, payment_model_ids ON public.company_financial_adjustments
FOR EACH ROW EXECUTE FUNCTION public.sync_cfa_payment_model_ids();