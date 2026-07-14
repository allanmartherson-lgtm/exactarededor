ALTER TABLE public.rule_calculations
  DISABLE TRIGGER trg_enforce_hospital_rule_calculations;

ALTER TABLE public.rule_calculations
  DISABLE TRIGGER trg_enforce_hospital_scope;