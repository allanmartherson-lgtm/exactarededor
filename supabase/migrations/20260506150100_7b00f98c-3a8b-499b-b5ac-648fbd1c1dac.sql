
-- 1. Add tipo_item to payment_items
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS tipo_item text;

-- Move existing specialty content to tipo_item (it's actually act type today)
UPDATE public.payment_items
SET tipo_item = specialty
WHERE tipo_item IS NULL AND specialty IS NOT NULL;

-- Clear specialty so motor can repopulate with medical specialty
UPDATE public.payment_items SET specialty = NULL WHERE specialty IS NOT NULL;

-- 2. Procedure → medical specialty map
CREATE TABLE IF NOT EXISTS public.procedure_specialty_map (
  procedure_code text PRIMARY KEY,
  medical_specialty text NOT NULL,
  status text NOT NULL DEFAULT 'sugerido' CHECK (status IN ('sugerido','aprovado','rejeitado')),
  confidence_pct numeric,
  sample_size integer,
  description text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.procedure_specialty_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY psm_view_workflow ON public.procedure_specialty_map
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'analista'::app_role)
    OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)
    OR has_role(auth.uid(),'admin'::app_role)
  );

CREATE POLICY psm_manage_admin_diretor ON public.procedure_specialty_map
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

CREATE TRIGGER psm_touch_updated_at
  BEFORE UPDATE ON public.procedure_specialty_map
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_psm_status ON public.procedure_specialty_map(status);
