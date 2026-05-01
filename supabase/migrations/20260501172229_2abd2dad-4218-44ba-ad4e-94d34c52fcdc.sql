
CREATE TYPE public.rule_scope AS ENUM ('master', 'especifica');
CREATE TYPE public.rule_sector AS ENUM ('cirurgia', 'hemodinamica', 'parecer', 'visita', 'procedimento', 'consulta', 'outro');
CREATE TYPE public.rule_target_type AS ENUM ('medico', 'empresa');

ALTER TABLE public.rules
  ADD COLUMN scope public.rule_scope NOT NULL DEFAULT 'master',
  ADD COLUMN sector public.rule_sector NOT NULL DEFAULT 'outro',
  ADD COLUMN target_type public.rule_target_type,
  ADD COLUMN target_identifier text,
  ADD COLUMN target_name text;

CREATE INDEX idx_rules_scope_sector ON public.rules (scope, sector);
CREATE INDEX idx_rules_target ON public.rules (target_type, target_identifier);
