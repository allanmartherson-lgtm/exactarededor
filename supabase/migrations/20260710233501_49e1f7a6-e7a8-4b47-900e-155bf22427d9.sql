
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check CHECK (entity_type = ANY (ARRAY['rule','rule_calculation','payment','payment_item','user','profile','access_request','company','doctor','invoice','notification','glosa_debt','pool_deduction_value','doctor_company']));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action = ANY (ARRAY['create','update','create_via_rpc','update_via_rpc','auto_set_valid_until','delete','profile_updated','created','updated','deleted','approved','rejected','reactivated','deactivated','role_added','role_removed','password_reset','invite_resent','calc_reduction_confirmed','soft_closed','import_replaced']));
