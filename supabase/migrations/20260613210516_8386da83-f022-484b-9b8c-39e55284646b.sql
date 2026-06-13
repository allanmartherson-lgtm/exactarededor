
-- ============================================================
-- 1. hospital_settings (thresholds de re-aprovação por hospital)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hospital_settings (
  hospital_id uuid PRIMARY KEY REFERENCES public.hospitals(id) ON DELETE CASCADE,
  reapproval_threshold_pct numeric NOT NULL DEFAULT 0,
  reapproval_threshold_brl numeric NOT NULL DEFAULT 0.01,
  reapproval_require_reason boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_settings TO authenticated;
GRANT ALL ON public.hospital_settings TO service_role;

ALTER TABLE public.hospital_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital settings select by hospital members"
  ON public.hospital_settings FOR SELECT
  TO authenticated
  USING (
    hospital_id = public.current_active_hospital()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Hospital settings insert by admin"
  ON public.hospital_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hospital settings update by admin"
  ON public.hospital_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hospital settings delete by admin"
  ON public.hospital_settings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_hospital_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hospital_settings_updated_at ON public.hospital_settings;
CREATE TRIGGER hospital_settings_updated_at
  BEFORE UPDATE ON public.hospital_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_hospital_settings_updated_at();

-- ============================================================
-- 2. payment_company_groups (versionamento + flag de re-aprovação)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.reapproval_trigger_source AS ENUM (
    'analyst_edit',
    'invoice_pendency',
    'company_change_source',
    'company_change_destination'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS approval_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reapproval_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reapproval_reason text,
  ADD COLUMN IF NOT EXISTS reapproval_triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS reapproval_trigger_source public.reapproval_trigger_source,
  ADD COLUMN IF NOT EXISTS last_approved_bruto numeric,
  ADD COLUMN IF NOT EXISTS last_approved_liquido numeric,
  ADD COLUMN IF NOT EXISTS last_approved_company_id uuid;

-- ============================================================
-- 3. company_group_approvals (histórico imutável)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_group_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_company_group_id uuid NOT NULL REFERENCES public.payment_company_groups(id) ON DELETE CASCADE,
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  version integer NOT NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  bruto_total numeric NOT NULL DEFAULT 0,
  liquido_total numeric NOT NULL DEFAULT 0,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  items_snapshot jsonb,
  pdf_url text,
  magic_link_token_id uuid,
  reason text,
  superseded_at timestamptz,
  superseded_by_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_company_group_id, version)
);

CREATE INDEX IF NOT EXISTS idx_company_group_approvals_group
  ON public.company_group_approvals(payment_company_group_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_company_group_approvals_hospital
  ON public.company_group_approvals(hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_group_approvals TO authenticated;
GRANT ALL ON public.company_group_approvals TO service_role;

ALTER TABLE public.company_group_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group approvals select by hospital members"
  ON public.company_group_approvals FOR SELECT
  TO authenticated
  USING (
    hospital_id = public.current_active_hospital()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Group approvals insert by admin"
  ON public.company_group_approvals FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Group approvals update none"
  ON public.company_group_approvals FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Group approvals delete by admin"
  ON public.company_group_approvals FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4. Trigger: detectar alteração relevante e marcar pendente
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_detect_group_reapproval()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_pct numeric;
  v_brl numeric;
  v_delta_bruto numeric;
  v_delta_liquido numeric;
  v_changed_company boolean;
  v_settings record;
BEGIN
  -- só atua em grupos que já tiveram pelo menos uma aprovação
  IF COALESCE(NEW.approval_version, 0) = 0 THEN
    RETURN NEW;
  END IF;

  -- já pendente: não re-marca por idempotência
  IF NEW.reapproval_pending = true AND OLD.reapproval_pending = true THEN
    RETURN NEW;
  END IF;

  SELECT reapproval_threshold_pct, reapproval_threshold_brl
    INTO v_settings
    FROM public.hospital_settings
   WHERE hospital_id = NEW.hospital_id;

  v_pct := COALESCE(v_settings.reapproval_threshold_pct, 0);
  v_brl := COALESCE(v_settings.reapproval_threshold_brl, 0.01);

  v_delta_bruto   := ABS(COALESCE(NEW.bruto_total, 0)   - COALESCE(NEW.last_approved_bruto, 0));
  v_delta_liquido := ABS(COALESCE(NEW.liquido_total, 0) - COALESCE(NEW.last_approved_liquido, 0));
  v_changed_company := NEW.company_id IS DISTINCT FROM NEW.last_approved_company_id;

  IF v_changed_company
     OR v_delta_bruto   > v_brl
     OR v_delta_liquido > v_brl
     OR (NEW.last_approved_bruto > 0   AND (v_delta_bruto   / NEW.last_approved_bruto)   * 100 > v_pct)
     OR (NEW.last_approved_liquido > 0 AND (v_delta_liquido / NEW.last_approved_liquido) * 100 > v_pct)
  THEN
    NEW.reapproval_pending := true;
    NEW.reapproval_triggered_at := COALESCE(NEW.reapproval_triggered_at, now());
    NEW.reapproval_trigger_source := COALESCE(
      NEW.reapproval_trigger_source,
      CASE WHEN v_changed_company THEN 'company_change_source'::public.reapproval_trigger_source
           ELSE 'analyst_edit'::public.reapproval_trigger_source END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_group_reapproval ON public.payment_company_groups;
CREATE TRIGGER trg_detect_group_reapproval
  BEFORE UPDATE OF bruto_total, liquido_total, company_id, total_amount
  ON public.payment_company_groups
  FOR EACH ROW
  WHEN (OLD.approval_version > 0)
  EXECUTE FUNCTION public.tg_detect_group_reapproval();

-- ============================================================
-- 5. Trigger: bloquear avanço enquanto pendente
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_group_advance_on_reapproval()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.reapproval_pending = true
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','lancado','pago')
  THEN
    RAISE EXCEPTION 'Grupo % com re-aprovação pendente — não pode avançar para %', NEW.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_group_advance_on_reapproval ON public.payment_company_groups;
CREATE TRIGGER trg_block_group_advance_on_reapproval
  BEFORE UPDATE OF status
  ON public.payment_company_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_group_advance_on_reapproval();

-- ============================================================
-- 6. Trigger: snapshot após nova aprovação inserida
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_apply_group_approval_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- marca versão anterior como substituída
  UPDATE public.company_group_approvals
     SET superseded_at = now(),
         superseded_by_version = NEW.version
   WHERE payment_company_group_id = NEW.payment_company_group_id
     AND version < NEW.version
     AND superseded_at IS NULL;

  -- atualiza snapshot no grupo, incrementa versão, libera pendência
  UPDATE public.payment_company_groups
     SET approval_version = NEW.version,
         reapproval_pending = false,
         reapproval_reason = NULL,
         reapproval_triggered_at = NULL,
         reapproval_trigger_source = NULL,
         last_approved_bruto = NEW.bruto_total,
         last_approved_liquido = NEW.liquido_total,
         last_approved_company_id = NEW.company_id,
         updated_at = now()
   WHERE id = NEW.payment_company_group_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_group_approval_snapshot ON public.company_group_approvals;
CREATE TRIGGER trg_apply_group_approval_snapshot
  AFTER INSERT ON public.company_group_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_group_approval_snapshot();

-- ============================================================
-- 7. Trigger: troca de company_id em item de grupo aprovado
-- marca origem + destino como pendentes
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_company_change_dual_reapproval()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_src_group uuid;
  v_dst_group uuid;
BEGIN
  IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;

  -- localiza grupos vinculados ao payment do item (origem = company antiga, destino = nova)
  SELECT id INTO v_src_group
    FROM public.payment_company_groups
   WHERE payment_id = NEW.payment_id AND company_id = OLD.company_id
   LIMIT 1;

  SELECT id INTO v_dst_group
    FROM public.payment_company_groups
   WHERE payment_id = NEW.payment_id AND company_id = NEW.company_id
   LIMIT 1;

  IF v_src_group IS NOT NULL THEN
    UPDATE public.payment_company_groups
       SET reapproval_pending = true,
           reapproval_triggered_at = COALESCE(reapproval_triggered_at, now()),
           reapproval_trigger_source = COALESCE(reapproval_trigger_source, 'company_change_source')
     WHERE id = v_src_group AND approval_version > 0;
  END IF;

  IF v_dst_group IS NOT NULL THEN
    UPDATE public.payment_company_groups
       SET reapproval_pending = true,
           reapproval_triggered_at = COALESCE(reapproval_triggered_at, now()),
           reapproval_trigger_source = COALESCE(reapproval_trigger_source, 'company_change_destination')
     WHERE id = v_dst_group AND approval_version > 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_change_dual_reapproval ON public.payment_items;
CREATE TRIGGER trg_company_change_dual_reapproval
  AFTER UPDATE OF company_id ON public.payment_items
  FOR EACH ROW
  WHEN (OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION public.tg_company_change_dual_reapproval();
