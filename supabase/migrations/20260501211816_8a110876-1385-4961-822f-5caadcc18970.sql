-- Tabela de auditoria genérica para regras e pagamentos
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('rule','payment')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update')),
  actor_id uuid,
  company_id uuid,
  company_name text,
  company_document text,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_company_idx ON public.audit_log (company_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_view_authenticated
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY audit_log_insert_self
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = actor_id);
