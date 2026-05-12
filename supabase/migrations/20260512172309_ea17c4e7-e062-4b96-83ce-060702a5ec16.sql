ALTER TABLE public.rules
  DROP COLUMN IF EXISTS rule_type,
  DROP COLUMN IF EXISTS sector,
  DROP COLUMN IF EXISTS payment_term,
  DROP COLUMN IF EXISTS applies_payment_types,
  DROP COLUMN IF EXISTS doctors,
  DROP COLUMN IF EXISTS group_company_ids,
  DROP COLUMN IF EXISTS group_doctors,
  DROP COLUMN IF EXISTS rule_json;

DROP TYPE IF EXISTS public.rule_type;
DROP TYPE IF EXISTS public.payment_term;