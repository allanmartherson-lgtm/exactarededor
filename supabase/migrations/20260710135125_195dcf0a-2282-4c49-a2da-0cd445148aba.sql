-- Torna motivos de intervenção manual globais (hospital_id = NULL)
UPDATE public.manual_intervention_reasons SET hospital_id = NULL WHERE hospital_id IS NOT NULL;

-- Índice único por código quando global (evita duplicidade de seeds globais)
CREATE UNIQUE INDEX IF NOT EXISTS manual_intervention_reasons_code_global_uidx
  ON public.manual_intervention_reasons (code)
  WHERE hospital_id IS NULL;