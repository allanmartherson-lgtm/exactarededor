ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY[
    'rule','rule_calculation','payment','payment_item',
    'user','profile','access_request',
    'company','doctor','invoice','notification'
  ]));