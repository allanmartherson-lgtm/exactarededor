
-- 1) Tornar user_id nullable + trocar CASCADE por SET NULL
ALTER TABLE public.doctor_portal_users
  DROP CONSTRAINT IF EXISTS doctor_portal_users_user_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD CONSTRAINT doctor_portal_users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.company_portal_users
  DROP CONSTRAINT IF EXISTS company_portal_users_user_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD CONSTRAINT company_portal_users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.doctor_portal_users
  DROP CONSTRAINT IF EXISTS doctor_portal_users_doctor_id_fkey,
  ADD CONSTRAINT doctor_portal_users_doctor_id_fkey
    FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE RESTRICT;

ALTER TABLE public.company_portal_users
  DROP CONSTRAINT IF EXISTS company_portal_users_company_id_fkey,
  ADD CONSTRAINT company_portal_users_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

-- 2) Email denormalizado (chave de auto-religamento)
ALTER TABLE public.doctor_portal_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.company_portal_users ADD COLUMN IF NOT EXISTS email text;

UPDATE public.doctor_portal_users dpu
  SET email = lower(au.email)
  FROM auth.users au
  WHERE dpu.user_id = au.id AND dpu.email IS NULL AND au.email IS NOT NULL;

UPDATE public.company_portal_users cpu
  SET email = lower(au.email)
  FROM auth.users au
  WHERE cpu.user_id = au.id AND cpu.email IS NULL AND au.email IS NOT NULL;

CREATE INDEX IF NOT EXISTS doctor_portal_users_email_idx
  ON public.doctor_portal_users (lower(email));
CREATE INDEX IF NOT EXISTS company_portal_users_email_idx
  ON public.company_portal_users (lower(email));

-- 3) Coluna derivada link_health
DO $$ BEGIN
  CREATE TYPE public.portal_link_health AS ENUM ('ok','orphan_user','orphan_target','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.doctor_portal_users
  ADD COLUMN IF NOT EXISTS link_health public.portal_link_health NOT NULL DEFAULT 'ok';
ALTER TABLE public.company_portal_users
  ADD COLUMN IF NOT EXISTS link_health public.portal_link_health NOT NULL DEFAULT 'ok';

CREATE OR REPLACE FUNCTION public.compute_doctor_portal_link_health()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE has_user boolean; has_doc boolean;
BEGIN
  IF NEW.user_id IS NULL THEN has_user := false;
  ELSE SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) INTO has_user; END IF;
  SELECT EXISTS (SELECT 1 FROM public.doctors WHERE id = NEW.doctor_id) INTO has_doc;
  IF NOT has_user THEN NEW.link_health := 'orphan_user';
  ELSIF NOT has_doc THEN NEW.link_health := 'orphan_target';
  ELSIF NEW.active = false THEN NEW.link_health := 'inactive';
  ELSE NEW.link_health := 'ok'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.compute_company_portal_link_health()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE has_user boolean; has_co boolean;
BEGIN
  IF NEW.user_id IS NULL THEN has_user := false;
  ELSE SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) INTO has_user; END IF;
  SELECT EXISTS (SELECT 1 FROM public.companies WHERE id = NEW.company_id) INTO has_co;
  IF NOT has_user THEN NEW.link_health := 'orphan_user';
  ELSIF NOT has_co THEN NEW.link_health := 'orphan_target';
  ELSIF NEW.active = false THEN NEW.link_health := 'inactive';
  ELSE NEW.link_health := 'ok'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_doctor_portal_users_link_health ON public.doctor_portal_users;
CREATE TRIGGER trg_doctor_portal_users_link_health
  BEFORE INSERT OR UPDATE OF user_id, doctor_id, active
  ON public.doctor_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.compute_doctor_portal_link_health();

DROP TRIGGER IF EXISTS trg_company_portal_users_link_health ON public.company_portal_users;
CREATE TRIGGER trg_company_portal_users_link_health
  BEFORE INSERT OR UPDATE OF user_id, company_id, active
  ON public.company_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.compute_company_portal_link_health();

UPDATE public.doctor_portal_users SET user_id = user_id;
UPDATE public.company_portal_users SET user_id = user_id;

-- 4) Religamento automático na inserção/atualização de auth.users
CREATE OR REPLACE FUNCTION public.relink_portal_users_on_auth()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  UPDATE public.doctor_portal_users
    SET user_id = NEW.id
    WHERE user_id IS NULL AND lower(email) = lower(NEW.email);
  UPDATE public.company_portal_users
    SET user_id = NEW.id
    WHERE user_id IS NULL AND lower(email) = lower(NEW.email);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_relink_portal_users_on_auth_insert ON auth.users;
CREATE TRIGGER trg_relink_portal_users_on_auth_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.relink_portal_users_on_auth();

DROP TRIGGER IF EXISTS trg_relink_portal_users_on_auth_update ON auth.users;
CREATE TRIGGER trg_relink_portal_users_on_auth_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.relink_portal_users_on_auth();

-- 5) RPC admin: repair_portal_links()
CREATE OR REPLACE FUNCTION public.repair_portal_links()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE d_fixed int := 0; c_fixed int := 0; d_left int := 0; c_left int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH upd AS (
    UPDATE public.doctor_portal_users dpu
      SET user_id = au.id
      FROM auth.users au
      WHERE dpu.user_id IS NULL AND dpu.email IS NOT NULL
        AND lower(dpu.email) = lower(au.email)
      RETURNING dpu.id
  ) SELECT count(*) INTO d_fixed FROM upd;

  WITH upd AS (
    UPDATE public.company_portal_users cpu
      SET user_id = au.id
      FROM auth.users au
      WHERE cpu.user_id IS NULL AND cpu.email IS NOT NULL
        AND lower(cpu.email) = lower(au.email)
      RETURNING cpu.id
  ) SELECT count(*) INTO c_fixed FROM upd;

  SELECT count(*) INTO d_left FROM public.doctor_portal_users WHERE link_health <> 'ok';
  SELECT count(*) INTO c_left FROM public.company_portal_users WHERE link_health <> 'ok';

  RETURN jsonb_build_object(
    'doctor_fixed', d_fixed, 'company_fixed', c_fixed,
    'doctor_remaining', d_left, 'company_remaining', c_left
  );
END; $$;

REVOKE ALL ON FUNCTION public.repair_portal_links() FROM public;
GRANT EXECUTE ON FUNCTION public.repair_portal_links() TO authenticated;

-- 6) View consumida pelo painel
CREATE OR REPLACE VIEW public.portal_links_health AS
SELECT 'doctor'::text AS portal_type, dpu.id, dpu.email, dpu.active, dpu.link_health,
       dpu.doctor_id AS target_id, d.full_name AS target_name,
       dpu.user_id, dpu.created_at, dpu.accepted_at
  FROM public.doctor_portal_users dpu
  LEFT JOIN public.doctors d ON d.id = dpu.doctor_id
UNION ALL
SELECT 'company'::text, cpu.id, cpu.email, cpu.active, cpu.link_health,
       cpu.company_id, c.name,
       cpu.user_id, cpu.created_at, cpu.accepted_at
  FROM public.company_portal_users cpu
  LEFT JOIN public.companies c ON c.id = cpu.company_id;

GRANT SELECT ON public.portal_links_health TO authenticated;
