
ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS tuss_default text,
  ADD COLUMN IF NOT EXISTS tuss_codes_extra text[] DEFAULT ARRAY[]::text[];

-- Copia TUSS default / extras de payment_types para item_types (match por code)
UPDATE public.item_types it
SET tuss_default = pt.tuss_default,
    tuss_codes_extra = COALESCE(pt.tuss_codes_extra, ARRAY[]::text[])
FROM public.payment_types pt
WHERE pt.code = it.code
  AND (pt.tuss_default IS NOT NULL OR coalesce(array_length(pt.tuss_codes_extra,1),0) > 0);

CREATE INDEX IF NOT EXISTS item_types_tuss_default_idx
  ON public.item_types (tuss_default)
  WHERE tuss_default IS NOT NULL;
