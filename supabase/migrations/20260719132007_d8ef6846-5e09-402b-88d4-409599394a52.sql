ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS adicional_urgencia_pct numeric;

COMMENT ON COLUMN public.rule_calculations.adicional_urgencia_pct IS
  'Adicional (%) aplicado quando o atendimento é urgência OU emergência, independente de dia/horário. Entra no mesmo pool "só o maior" dos adicionais FDS/Feriado/Noturno. Nullable = sem adicional de urgência.';