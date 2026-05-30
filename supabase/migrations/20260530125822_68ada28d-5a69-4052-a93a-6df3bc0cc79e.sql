ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS tasy_code text,
  ADD COLUMN IF NOT EXISTS classification text;

CREATE INDEX IF NOT EXISTS idx_sectors_tasy_code ON public.sectors(tasy_code);
CREATE INDEX IF NOT EXISTS idx_sectors_classification ON public.sectors(classification);