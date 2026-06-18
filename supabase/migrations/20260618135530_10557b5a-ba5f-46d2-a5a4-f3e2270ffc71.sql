CREATE TABLE IF NOT EXISTS public.tuss_audit_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_item_id uuid NOT NULL UNIQUE REFERENCES public.payment_items(id) ON DELETE CASCADE,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  justification text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tuss_audit_overrides_item ON public.tuss_audit_overrides(payment_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tuss_audit_overrides TO authenticated;
GRANT ALL ON public.tuss_audit_overrides TO service_role;

ALTER TABLE public.tuss_audit_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read tuss overrides" ON public.tuss_audit_overrides;
CREATE POLICY "auth read tuss overrides"
  ON public.tuss_audit_overrides FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth write tuss overrides" ON public.tuss_audit_overrides;
CREATE POLICY "auth write tuss overrides"
  ON public.tuss_audit_overrides FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth update tuss overrides" ON public.tuss_audit_overrides;
CREATE POLICY "auth update tuss overrides"
  ON public.tuss_audit_overrides FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth delete tuss overrides" ON public.tuss_audit_overrides;
CREATE POLICY "auth delete tuss overrides"
  ON public.tuss_audit_overrides FOR DELETE
  TO authenticated USING (true);