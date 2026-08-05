ALTER TABLE public.agreement_registrations
  ALTER COLUMN convenio_exceptions DROP DEFAULT,
  ALTER COLUMN convenio_exceptions TYPE text[] USING convenio_exceptions::text[],
  ALTER COLUMN convenio_exceptions SET DEFAULT '{}'::text[];