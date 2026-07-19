
CREATE TABLE public.payment_batch_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  expected_setor TEXT,
  expected_convenio_group TEXT,
  avg_bruto NUMERIC,
  months_seen INTEGER NOT NULL DEFAULT 0,
  last_seen_month DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, code)
);

CREATE INDEX idx_pbp_hospital_active ON public.payment_batch_patterns (hospital_id, active);
CREATE INDEX idx_pbp_aliases_gin ON public.payment_batch_patterns USING gin (aliases);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_batch_patterns TO authenticated;
GRANT ALL ON public.payment_batch_patterns TO service_role;

ALTER TABLE public.payment_batch_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pbp_select_by_hospital"
ON public.payment_batch_patterns
FOR SELECT
TO authenticated
USING (public.hospital_scope_allows(hospital_id));

CREATE POLICY "pbp_insert_by_hospital_staff"
ON public.payment_batch_patterns
FOR INSERT
TO authenticated
WITH CHECK (
  public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
);

CREATE POLICY "pbp_update_by_hospital_staff"
ON public.payment_batch_patterns
FOR UPDATE
TO authenticated
USING (
  public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
);

CREATE POLICY "pbp_delete_admin_only"
ON public.payment_batch_patterns
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_pbp_updated_at
BEFORE UPDATE ON public.payment_batch_patterns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS batch_pattern_id UUID
  REFERENCES public.payment_batch_patterns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_batch_pattern ON public.payments (batch_pattern_id);
