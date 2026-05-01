ALTER TABLE public.reference_table_items
ADD COLUMN port_multiplier numeric NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.reference_table_items.port_multiplier IS 'Fração do porte aplicada (CBHPM lab/transfusional). Ex.: 0.10 = 10% do valor do porte base. Default 1 = porte cheio.';