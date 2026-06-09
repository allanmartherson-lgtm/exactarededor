
CREATE INDEX IF NOT EXISTS idx_doctors_full_name_norm
  ON public.doctors (public.normalize_alias(full_name))
  WHERE specialties IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_aliases_norm
  ON public.doctor_aliases (alias_normalized);

ANALYZE public.doctors;
ANALYZE public.doctor_aliases;
