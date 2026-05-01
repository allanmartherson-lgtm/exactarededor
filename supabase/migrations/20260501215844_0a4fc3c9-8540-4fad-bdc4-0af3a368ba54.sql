ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS competence_months date[] NOT NULL DEFAULT '{}';

UPDATE public.payments
   SET competence_months = ARRAY[competence_month]
 WHERE competence_month IS NOT NULL
   AND (array_length(competence_months,1) IS NULL);