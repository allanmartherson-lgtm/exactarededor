
-- Novos campos de aprovação
ALTER TABLE public.comm_campaigns
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_comm_campaigns_approval_status
  ON public.comm_campaigns(approval_status);

-- Trigger: define approval_status conforme papel do criador
CREATE OR REPLACE FUNCTION public.set_campaign_approval_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_supervisor boolean;
BEGIN
  -- Admin ou diretor = supervisor (auto-aprovado)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = NEW.created_by
       AND role IN ('admin','diretor')
  ) INTO is_supervisor;

  IF is_supervisor THEN
    NEW.approval_status := 'approved';
    NEW.approved_by     := NEW.created_by;
    NEW.approved_at     := now();
  ELSE
    NEW.approval_status := 'pending';
    NEW.approved_by     := NULL;
    NEW.approved_at     := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_campaign_approval ON public.comm_campaigns;
CREATE TRIGGER trg_set_campaign_approval
BEFORE INSERT ON public.comm_campaigns
FOR EACH ROW EXECUTE FUNCTION public.set_campaign_approval_on_insert();

-- RPC: aprovar campanha (só admin/diretor)
CREATE OR REPLACE FUNCTION public.approve_campaign(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'diretor') THEN
    RAISE EXCEPTION 'Apenas admin ou diretor podem aprovar campanhas';
  END IF;

  UPDATE public.comm_campaigns
     SET approval_status = 'approved',
         approved_by     = auth.uid(),
         approved_at     = now(),
         rejection_reason = NULL
   WHERE id = _campaign_id
     AND approval_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada ou já processada';
  END IF;
END;
$$;

-- RPC: rejeitar campanha
CREATE OR REPLACE FUNCTION public.reject_campaign(_campaign_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'diretor') THEN
    RAISE EXCEPTION 'Apenas admin ou diretor podem rejeitar campanhas';
  END IF;

  UPDATE public.comm_campaigns
     SET approval_status = 'rejected',
         approved_by     = auth.uid(),
         approved_at     = now(),
         rejection_reason = COALESCE(_reason, 'Sem motivo informado')
   WHERE id = _campaign_id
     AND approval_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada ou já processada';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_campaign(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_campaign(uuid, text) TO authenticated;
