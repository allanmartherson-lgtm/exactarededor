
CREATE TABLE IF NOT EXISTS public.analysis_dead_letter (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_job_id UUID,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analysis_dead_letter_payment_company_uk UNIQUE (payment_id, company_name)
);

GRANT SELECT, INSERT, UPDATE ON public.analysis_dead_letter TO authenticated;
GRANT ALL ON public.analysis_dead_letter TO service_role;

ALTER TABLE public.analysis_dead_letter ENABLE ROW LEVEL SECURITY;

CREATE POLICY adl_view_workflow ON public.analysis_dead_letter
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'analista'::app_role)
      OR has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY adl_insert_workflow ON public.analysis_dead_letter
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'analista'::app_role)
      OR has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY adl_update_workflow ON public.analysis_dead_letter
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_adl_payment ON public.analysis_dead_letter(payment_id);
CREATE INDEX IF NOT EXISTS idx_adl_status ON public.analysis_dead_letter(status, updated_at DESC);

ALTER TABLE public.payment_job_context
  ADD COLUMN IF NOT EXISTS is_snapshot BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pjc_snapshot ON public.payment_job_context(payment_id, is_snapshot) WHERE is_snapshot = true;
