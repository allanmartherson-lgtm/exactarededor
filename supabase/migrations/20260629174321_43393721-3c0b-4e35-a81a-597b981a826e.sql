ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS match_by_specialty boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rule_calculations.match_by_specialty IS
'Quando true E specialties[] não vazio, o motor filtra itens cuja especialidade casa. False = ignora specialties[] no match (comportamento default — especialidade volta a ser só informativo).';

-- Backfill: preserva comportamento atual para cálculos que já têm specialties cadastradas.
UPDATE public.rule_calculations
   SET match_by_specialty = true
 WHERE match_by_specialty = false
   AND specialties IS NOT NULL
   AND array_length(specialties, 1) > 0;

-- Equivalente para a coluna legada em rules (informativa). Mantém simetria caso UI futura
-- queira expor o toggle no nível regra; o motor segue ignorando rule.specialties.
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS match_by_specialty boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.rules.match_by_specialty IS
'Toggle informativo no nível regra. Filtro real é feito por rule_calculations.match_by_specialty.';