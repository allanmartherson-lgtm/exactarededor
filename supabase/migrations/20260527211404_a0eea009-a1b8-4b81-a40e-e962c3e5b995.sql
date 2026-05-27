
-- Sprint 3.B: cache de contexto compartilhado por job de análise.
-- Evita que cada worker (empresa) recarregue rules/refs/companies/doctors etc.
-- TTL curto controlado pela aplicação (built_at). Sem RLS — uso interno via service_role.

CREATE TABLE IF NOT EXISTS public.payment_job_context (
  job_id uuid PRIMARY KEY,
  payment_id uuid NOT NULL,
  context jsonb NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now(),
  size_bytes integer,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT ALL ON public.payment_job_context TO service_role;
-- Sem grants para anon/authenticated: tabela é puramente backend.

ALTER TABLE public.payment_job_context ENABLE ROW LEVEL SECURITY;

-- Bloqueia totalmente acesso fora de service_role (sem policies = nega tudo).
-- Nenhuma policy criada de propósito.

CREATE INDEX IF NOT EXISTS idx_payment_job_context_payment ON public.payment_job_context(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_job_context_built_at ON public.payment_job_context(built_at DESC);

-- Sprint 3.E: índices que aceleram leituras críticas do motor.
CREATE INDEX IF NOT EXISTS idx_payment_items_payment_company
  ON public.payment_items(payment_id, company_name);

CREATE INDEX IF NOT EXISTS idx_rule_calculations_rule
  ON public.rule_calculations(rule_id);
