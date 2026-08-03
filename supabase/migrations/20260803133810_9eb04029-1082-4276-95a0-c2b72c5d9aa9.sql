CREATE TABLE IF NOT EXISTS public.access_request_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.access_request_attempts TO service_role;

ALTER TABLE public.access_request_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ara_no_client_access ON public.access_request_attempts;
CREATE POLICY ara_no_client_access
  ON public.access_request_attempts
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ara_ip_created ON public.access_request_attempts(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ara_email_created ON public.access_request_attempts(lower(email), created_at DESC);

-- Somente a edge function (service role) pode inserir solicitações a partir de agora.
DROP POLICY IF EXISTS ar_insert_anon ON public.access_requests;
DROP POLICY IF EXISTS ar_insert_authenticated ON public.access_requests;