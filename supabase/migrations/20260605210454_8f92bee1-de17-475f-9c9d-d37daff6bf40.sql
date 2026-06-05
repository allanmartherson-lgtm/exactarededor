
-- ============================================================
-- 1) doctors.code (MED-NNNNN) + deactivated_at
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.doctors_code_seq START 1;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE public.doctors
SET code = 'MED-' || lpad(nextval('public.doctors_code_seq')::text, 5, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS doctors_code_uidx ON public.doctors(code);
ALTER TABLE public.doctors ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.doctors ALTER COLUMN code SET DEFAULT ('MED-' || lpad(nextval('public.doctors_code_seq')::text, 5, '0'));

-- ============================================================
-- 2) companies.code (EMP-NNNNN) + active + deactivated_at
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.companies_code_seq START 1;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE public.companies
SET code = 'EMP-' || lpad(nextval('public.companies_code_seq')::text, 5, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_code_uidx ON public.companies(code);
ALTER TABLE public.companies ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.companies ALTER COLUMN code SET DEFAULT ('EMP-' || lpad(nextval('public.companies_code_seq')::text, 5, '0'));

-- ============================================================
-- 3) convenios.code (CONV-NNN) + deactivated_at
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.convenios_code_seq START 1;
ALTER TABLE public.convenios ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.convenios ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE public.convenios
SET code = 'CONV-' || lpad(nextval('public.convenios_code_seq')::text, 3, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS convenios_code_uidx ON public.convenios(code);
ALTER TABLE public.convenios ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.convenios ALTER COLUMN code SET DEFAULT ('CONV-' || lpad(nextval('public.convenios_code_seq')::text, 3, '0'));

-- ============================================================
-- 4) sectors.code (SET-NNN) + deactivated_at
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.sectors_code_seq START 1;
ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE public.sectors
SET code = 'SET-' || lpad(nextval('public.sectors_code_seq')::text, 3, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sectors_code_uidx ON public.sectors(code);
ALTER TABLE public.sectors ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.sectors ALTER COLUMN code SET DEFAULT ('SET-' || lpad(nextval('public.sectors_code_seq')::text, 3, '0'));

-- ============================================================
-- 5) cost_centers.code (CC-NNNN) + deactivated_at
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.cost_centers_code_seq START 1;
ALTER TABLE public.cost_centers ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.cost_centers ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE public.cost_centers
SET code = 'CC-' || lpad(nextval('public.cost_centers_code_seq')::text, 4, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_code_uidx ON public.cost_centers(code);
ALTER TABLE public.cost_centers ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.cost_centers ALTER COLUMN code SET DEFAULT ('CC-' || lpad(nextval('public.cost_centers_code_seq')::text, 4, '0'));

-- ============================================================
-- Trigger: bloqueia UPDATE em `code` (imutável)
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_code_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Campo code é imutável (tabela %, registro %)', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_code_update_doctors ON public.doctors;
CREATE TRIGGER trg_prevent_code_update_doctors BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.prevent_code_update();

DROP TRIGGER IF EXISTS trg_prevent_code_update_companies ON public.companies;
CREATE TRIGGER trg_prevent_code_update_companies BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.prevent_code_update();

DROP TRIGGER IF EXISTS trg_prevent_code_update_convenios ON public.convenios;
CREATE TRIGGER trg_prevent_code_update_convenios BEFORE UPDATE ON public.convenios
  FOR EACH ROW EXECUTE FUNCTION public.prevent_code_update();

DROP TRIGGER IF EXISTS trg_prevent_code_update_sectors ON public.sectors;
CREATE TRIGGER trg_prevent_code_update_sectors BEFORE UPDATE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.prevent_code_update();

DROP TRIGGER IF EXISTS trg_prevent_code_update_cost_centers ON public.cost_centers;
CREATE TRIGGER trg_prevent_code_update_cost_centers BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_code_update();

-- ============================================================
-- Trigger: bloqueia DELETE (força soft delete via active=false)
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_registry_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão física não permitida em %. Use inativação (active=false) para preservar histórico e vínculos.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation',
          HINT = 'UPDATE ' || TG_TABLE_NAME || ' SET active=false, deactivated_at=now() WHERE id=...';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_doctors ON public.doctors;
CREATE TRIGGER trg_prevent_delete_doctors BEFORE DELETE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_companies ON public.companies;
CREATE TRIGGER trg_prevent_delete_companies BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_convenios ON public.convenios;
CREATE TRIGGER trg_prevent_delete_convenios BEFORE DELETE ON public.convenios
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_sectors ON public.sectors;
CREATE TRIGGER trg_prevent_delete_sectors BEFORE DELETE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_cost_centers ON public.cost_centers;
CREATE TRIGGER trg_prevent_delete_cost_centers BEFORE DELETE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registry_delete();

-- ============================================================
-- Trigger: marca deactivated_at quando active vira false
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_deactivated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.active = true AND NEW.active = false THEN
    NEW.deactivated_at := now();
  ELSIF OLD.active = false AND NEW.active = true THEN
    NEW.deactivated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_deact_doctors ON public.doctors;
CREATE TRIGGER trg_touch_deact_doctors BEFORE UPDATE OF active ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.touch_deactivated_at();

DROP TRIGGER IF EXISTS trg_touch_deact_companies ON public.companies;
CREATE TRIGGER trg_touch_deact_companies BEFORE UPDATE OF active ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_deactivated_at();

DROP TRIGGER IF EXISTS trg_touch_deact_convenios ON public.convenios;
CREATE TRIGGER trg_touch_deact_convenios BEFORE UPDATE OF active ON public.convenios
  FOR EACH ROW EXECUTE FUNCTION public.touch_deactivated_at();

DROP TRIGGER IF EXISTS trg_touch_deact_sectors ON public.sectors;
CREATE TRIGGER trg_touch_deact_sectors BEFORE UPDATE OF active ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.touch_deactivated_at();

DROP TRIGGER IF EXISTS trg_touch_deact_cost_centers ON public.cost_centers;
CREATE TRIGGER trg_touch_deact_cost_centers BEFORE UPDATE OF active ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.touch_deactivated_at();
