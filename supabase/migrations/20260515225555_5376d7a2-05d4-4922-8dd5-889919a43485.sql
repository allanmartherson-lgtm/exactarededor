ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY['rule'::text, 'payment'::text, 'payment_item'::text]));