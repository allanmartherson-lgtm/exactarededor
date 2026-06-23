-- Subtipo de caso dentro de Parecer (Visita vs Parecer)
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS case_subtype text,
  ADD COLUMN IF NOT EXISTS case_subtype_source text;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_case_subtype_check
  CHECK (case_subtype IS NULL OR case_subtype IN ('parecer','visita'));

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_case_subtype_source_check
  CHECK (case_subtype_source IS NULL OR case_subtype_source IN ('base','report_cross','manual','company_override','attendance_override','default'));

CREATE INDEX IF NOT EXISTS idx_payment_items_case_subtype
  ON public.payment_items (payment_id, case_subtype);

ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS default_case_subtype text;

ALTER TABLE public.payment_company_groups
  ADD CONSTRAINT payment_company_groups_default_case_subtype_check
  CHECK (default_case_subtype IS NULL OR default_case_subtype IN ('parecer','visita'));

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS case_subtype text;

ALTER TABLE public.rules
  ADD CONSTRAINT rules_case_subtype_check
  CHECK (case_subtype IS NULL OR case_subtype IN ('parecer','visita'));

CREATE INDEX IF NOT EXISTS idx_rules_case_subtype ON public.rules (case_subtype);

COMMENT ON COLUMN public.payment_items.case_subtype IS 'Subtipo dentro de Parecer: parecer (default) ou visita. NULL = não-parecer.';
COMMENT ON COLUMN public.payment_items.case_subtype_source IS 'Origem da classificação: base | report_cross | manual | company_override | attendance_override | default';
COMMENT ON COLUMN public.rules.case_subtype IS 'NULL = vale para qualquer subtipo. Setado = só casa com itens daquele subtipo.';