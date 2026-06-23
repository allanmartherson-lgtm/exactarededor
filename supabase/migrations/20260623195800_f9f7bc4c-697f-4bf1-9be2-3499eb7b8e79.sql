ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_case_subtype_check,
  DROP CONSTRAINT IF EXISTS payment_items_case_subtype_source_check;
DROP INDEX IF EXISTS public.idx_payment_items_case_subtype;
ALTER TABLE public.payment_items
  DROP COLUMN IF EXISTS case_subtype,
  DROP COLUMN IF EXISTS case_subtype_source;

ALTER TABLE public.payment_company_groups
  DROP CONSTRAINT IF EXISTS payment_company_groups_default_case_subtype_check;
ALTER TABLE public.payment_company_groups
  DROP COLUMN IF EXISTS default_case_subtype;

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_case_subtype_check;
DROP INDEX IF EXISTS public.idx_rules_case_subtype;
ALTER TABLE public.rules
  DROP COLUMN IF EXISTS case_subtype;

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_case_subtype_check;
DROP INDEX IF EXISTS public.idx_rule_calculations_case_subtype;
ALTER TABLE public.rule_calculations
  DROP COLUMN IF EXISTS case_subtype;