
CREATE TABLE public.analysis_telemetry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid,
  payment_id uuid NOT NULL,
  company_name text,
  total_ms integer NOT NULL DEFAULT 0,
  ai_ms integer NOT NULL DEFAULT 0,
  rules_ms integer NOT NULL DEFAULT 0,
  writes_ms integer NOT NULL DEFAULT 0,
  items_count integer NOT NULL DEFAULT 0,
  ai_items_count integer NOT NULL DEFAULT 0,
  cache_hit boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.analysis_telemetry TO authenticated;
GRANT ALL ON public.analysis_telemetry TO service_role;

ALTER TABLE public.analysis_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY at_view_workflow
ON public.analysis_telemetry
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE INDEX idx_analysis_telemetry_job ON public.analysis_telemetry(job_id);
CREATE INDEX idx_analysis_telemetry_payment ON public.analysis_telemetry(payment_id);
CREATE INDEX idx_analysis_telemetry_created ON public.analysis_telemetry(created_at DESC);
