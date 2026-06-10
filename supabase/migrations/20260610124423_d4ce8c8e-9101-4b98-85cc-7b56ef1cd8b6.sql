ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY[
    'rule'::text,
    'rule_calculation'::text,
    'payment'::text,
    'payment_item'::text,
    'user'::text,
    'profile'::text,
    'access_request'::text,
    'company'::text,
    'doctor'::text,
    'invoice'::text,
    'notification'::text,
    'glosa_debt'::text
  ]));