ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
UPDATE public.rules SET active = true WHERE active IS NULL;