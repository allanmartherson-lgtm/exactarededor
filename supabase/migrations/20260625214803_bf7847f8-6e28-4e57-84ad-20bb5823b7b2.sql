ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS garante_piso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS piso_valor numeric;

COMMENT ON COLUMN public.pools.garante_piso IS 'Quando true, cada participante real (não hospital_nao_paga) tem sua quota elevada até piso_valor; a diferença vira complemento bancado pelo hospital, lançado como dedução virtual no run.';
COMMENT ON COLUMN public.pools.piso_valor IS 'Valor mínimo por participante quando garante_piso=true. Ignorado quando garante_piso=false.';