-- Add per-calculation filters so each rule_calculation can restrict itself
-- by codes, agreements, doctor roles. This lets one rule have multiple
-- calculations with different scopes (e.g., bonus 3 codes / 1 code / general fallback).

ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS procedure_codes text[],
  ADD COLUMN IF NOT EXISTS code_match_mode text NOT NULL DEFAULT 'whitelist',
  ADD COLUMN IF NOT EXISTS doctor_roles text[],
  ADD COLUMN IF NOT EXISTS agreement_match_mode text,
  ADD COLUMN IF NOT EXISTS agreement_aliases text[];

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_code_match_mode_check;
ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_code_match_mode_check
  CHECK (code_match_mode IN ('whitelist','blacklist','any'));

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_agreement_match_mode_check;
ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_agreement_match_mode_check
  CHECK (agreement_match_mode IS NULL OR agreement_match_mode IN ('whitelist','blacklist'));

-- Backfill: for existing calculations, copy parent rule restrictions when calc has none.
UPDATE public.rule_calculations rc
   SET procedure_codes = COALESCE(rc.procedure_codes, r.procedure_codes),
       agreement_match_mode = COALESCE(rc.agreement_match_mode, r.agreement_match_mode),
       agreement_aliases = COALESCE(rc.agreement_aliases, r.agreement_aliases),
       sectors = CASE WHEN COALESCE(array_length(rc.sectors,1),0) = 0 THEN COALESCE(r.sectors, rc.sectors) ELSE rc.sectors END,
       specialties = CASE WHEN COALESCE(array_length(rc.specialties,1),0) = 0 THEN COALESCE(r.specialties, rc.specialties) ELSE rc.specialties END,
       allowed_access_routes = COALESCE(rc.allowed_access_routes, r.allowed_access_routes)
  FROM public.rules r
 WHERE rc.rule_id = r.id;