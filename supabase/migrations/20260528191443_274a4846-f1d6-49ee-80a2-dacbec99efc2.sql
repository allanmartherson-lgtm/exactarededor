
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON public.payments (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_competence_month ON public.payments (competence_month DESC) WHERE competence_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status_priority ON public.payments (status, priority_score DESC NULLS LAST, created_at DESC);
ANALYZE public.payments;
