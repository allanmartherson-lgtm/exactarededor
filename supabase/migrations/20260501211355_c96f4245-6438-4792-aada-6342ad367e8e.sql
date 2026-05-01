-- Janela temporal nas regras: dias da semana, feriados, horários, modalidade (eletiva/urgência)
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS time_mode text NOT NULL DEFAULT 'qualquer',
  ADD COLUMN IF NOT EXISTS weekdays smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS includes_holidays boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_start time without time zone,
  ADD COLUMN IF NOT EXISTS time_end time without time zone,
  ADD COLUMN IF NOT EXISTS elective_mode text NOT NULL DEFAULT 'qualquer';

COMMENT ON COLUMN public.rules.time_mode IS 'qualquer | comercial | fora_comercial | fim_de_semana | feriado | personalizado';
COMMENT ON COLUMN public.rules.weekdays IS 'Dias da semana (0=Domingo .. 6=Sábado) — usado quando time_mode=personalizado';
COMMENT ON COLUMN public.rules.includes_holidays IS 'Se true, feriados também aplicam à janela';
COMMENT ON COLUMN public.rules.elective_mode IS 'qualquer | eletiva | urgencia';