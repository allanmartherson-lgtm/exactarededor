-- 1) Enum de motivos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='retro_exclusion_reason') THEN
    CREATE TYPE public.retro_exclusion_reason AS ENUM (
      'mudanca_data_administrativa',
      'cancelamento_externo',
      'duplicidade_ja_resolvida',
      'acordo_diferenciado',
      'outro'
    );
  END IF;
END $$;

-- 2) Colunas novas em retroactive_reconciliation_items
ALTER TABLE public.retroactive_reconciliation_items
  ADD COLUMN IF NOT EXISTS excluir_do_encaminhamento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusion_reason public.retro_exclusion_reason NULL,
  ADD COLUMN IF NOT EXISTS exclusion_note text NULL,
  ADD COLUMN IF NOT EXISTS excluded_by uuid NULL,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz NULL;

-- 3) CHECKs de integridade
ALTER TABLE public.retroactive_reconciliation_items
  DROP CONSTRAINT IF EXISTS chk_retro_exclusao_completa;
ALTER TABLE public.retroactive_reconciliation_items
  ADD CONSTRAINT chk_retro_exclusao_completa CHECK (
    excluir_do_encaminhamento = false
    OR (exclusion_reason IS NOT NULL AND excluded_at IS NOT NULL)
  );

ALTER TABLE public.retroactive_reconciliation_items
  DROP CONSTRAINT IF EXISTS chk_retro_exclusao_outro_com_nota;
ALTER TABLE public.retroactive_reconciliation_items
  ADD CONSTRAINT chk_retro_exclusao_outro_com_nota CHECK (
    exclusion_reason IS DISTINCT FROM 'outro'
    OR (exclusion_note IS NOT NULL AND length(btrim(exclusion_note)) > 0)
  );

-- 4) Índice parcial para filtro rápido dos excluídos
CREATE INDEX IF NOT EXISTS idx_retro_recon_items_excluidos
  ON public.retroactive_reconciliation_items (reconciliation_id)
  WHERE excluir_do_encaminhamento = true;

-- 5) Comentários (documentação inline)
COMMENT ON COLUMN public.retroactive_reconciliation_items.excluir_do_encaminhamento IS
  'Analista marcou o item como exceção: não deve gerar adjustment na apuração. Item continua visível na UI.';
COMMENT ON COLUMN public.retroactive_reconciliation_items.exclusion_reason IS
  'Motivo estruturado da exclusão. Obrigatório quando excluir_do_encaminhamento=true.';
COMMENT ON COLUMN public.retroactive_reconciliation_items.exclusion_note IS
  'Nota livre. Obrigatória quando exclusion_reason=outro; opcional nos demais casos.';