ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS adicional_fds_pct numeric,
  ADD COLUMN IF NOT EXISTS adicional_feriado_pct numeric,
  ADD COLUMN IF NOT EXISTS adicional_noturno_pct numeric,
  ADD COLUMN IF NOT EXISTS noturno_inicio time without time zone,
  ADD COLUMN IF NOT EXISTS noturno_fim time without time zone;

COMMENT ON COLUMN public.rule_calculations.adicional_fds_pct IS '% adicional sobre tabela base do convênio quando atendimento for sábado ou domingo. NULL/0 = sem adicional.';
COMMENT ON COLUMN public.rule_calculations.adicional_feriado_pct IS '% adicional sobre tabela base quando data for feriado nacional BR (brHolidays).';
COMMENT ON COLUMN public.rule_calculations.adicional_noturno_pct IS '% adicional sobre tabela base quando hora cair na janela noturno_inicio→noturno_fim (pode cruzar meia-noite).';
COMMENT ON COLUMN public.rule_calculations.noturno_inicio IS 'Início da janela noturna (ex: 19:00).';
COMMENT ON COLUMN public.rule_calculations.noturno_fim IS 'Fim da janela noturna (ex: 07:00). Cruza meia-noite quando fim < início.';

ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_adicional_fds_pct_chk
    CHECK (adicional_fds_pct IS NULL OR (adicional_fds_pct >= 0 AND adicional_fds_pct <= 200)),
  ADD CONSTRAINT rule_calculations_adicional_feriado_pct_chk
    CHECK (adicional_feriado_pct IS NULL OR (adicional_feriado_pct >= 0 AND adicional_feriado_pct <= 200)),
  ADD CONSTRAINT rule_calculations_adicional_noturno_pct_chk
    CHECK (adicional_noturno_pct IS NULL OR (adicional_noturno_pct >= 0 AND adicional_noturno_pct <= 200)),
  ADD CONSTRAINT rule_calculations_noturno_window_chk
    CHECK (
      adicional_noturno_pct IS NULL
      OR adicional_noturno_pct = 0
      OR (noturno_inicio IS NOT NULL AND noturno_fim IS NOT NULL AND noturno_inicio <> noturno_fim)
    );