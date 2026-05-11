-- Add allowed_access_routes to rules table
ALTER TABLE public.rules 
ADD COLUMN allowed_access_routes TEXT[];

-- Add allowed_access_routes to rule_calculations table (for 1:N calculations)
ALTER TABLE public.rule_calculations 
ADD COLUMN allowed_access_routes TEXT[];

-- Add index for performance on rules
CREATE INDEX idx_rules_allowed_access_routes ON public.rules USING GIN(allowed_access_routes);

-- Add index for performance on rule_calculations
CREATE INDEX idx_rule_calculations_allowed_access_routes ON public.rule_calculations USING GIN(allowed_access_routes);
