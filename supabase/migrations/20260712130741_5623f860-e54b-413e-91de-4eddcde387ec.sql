
CREATE TABLE public.deduction_application_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  payment_id UUID,
  company_id UUID,
  debt_id UUID,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dae_payment ON public.deduction_application_events(payment_id);
CREATE INDEX idx_dae_company ON public.deduction_application_events(company_id);
CREATE INDEX idx_dae_debt ON public.deduction_application_events(debt_id);
CREATE INDEX idx_dae_hospital_created ON public.deduction_application_events(hospital_id, created_at DESC);

GRANT SELECT, INSERT ON public.deduction_application_events TO authenticated;
GRANT ALL ON public.deduction_application_events TO service_role;

ALTER TABLE public.deduction_application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read events"
ON public.deduction_application_events
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users insert their own events"
ON public.deduction_application_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
