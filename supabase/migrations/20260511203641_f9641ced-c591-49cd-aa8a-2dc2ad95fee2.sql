
-- Tabela de controle de jobs de análise por empresa (background processing)
CREATE TABLE public.payment_processing_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id uuid NOT NULL,
  total_companies integer NOT NULL DEFAULT 0,
  processed_companies integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'em_andamento', -- em_andamento | concluido | parcial
  failed_companies jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ppj_payment ON public.payment_processing_jobs(payment_id, started_at DESC);

ALTER TABLE public.payment_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppj_view_workflow
ON public.payment_processing_jobs
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY ppj_manage_workflow
ON public.payment_processing_jobs
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE TRIGGER trg_ppj_touch
BEFORE UPDATE ON public.payment_processing_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_processing_jobs;
ALTER TABLE public.payment_processing_jobs REPLICA IDENTITY FULL;

-- RPC atômica para incrementar progresso e marcar concluído
CREATE OR REPLACE FUNCTION public.increment_processing_progress(
  _job_id uuid,
  _company_name text,
  _error text DEFAULT NULL
)
RETURNS public.payment_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.payment_processing_jobs;
BEGIN
  UPDATE public.payment_processing_jobs
  SET processed_companies = processed_companies + 1,
      failed_companies = CASE
        WHEN _error IS NULL THEN failed_companies
        ELSE failed_companies || jsonb_build_object('company_name', _company_name, 'error', _error, 'at', now())
      END,
      finished_at = CASE
        WHEN processed_companies + 1 >= total_companies THEN now()
        ELSE finished_at
      END,
      status = CASE
        WHEN processed_companies + 1 >= total_companies THEN
          CASE WHEN jsonb_array_length(
            CASE WHEN _error IS NULL THEN failed_companies
                 ELSE failed_companies || jsonb_build_object('company_name', _company_name, 'error', _error)
            END
          ) > 0 THEN 'parcial' ELSE 'concluido' END
        ELSE 'em_andamento'
      END
  WHERE id = _job_id
  RETURNING * INTO job;
  RETURN job;
END;
$$;
