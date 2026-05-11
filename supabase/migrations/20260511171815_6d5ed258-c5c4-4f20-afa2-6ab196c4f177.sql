-- Adiciona campos de diagnóstico na tabela payments (que gerencia os lotes)
ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS processing_diagnostics JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS processing_timeout_occurred BOOLEAN DEFAULT false;

-- Comentários para documentação
COMMENT ON COLUMN public.payments.processing_diagnostics IS 'Armazena estatísticas de processamento: total_items, ai_processed_items, chunk_size, execution_time_ms.';
COMMENT ON COLUMN public.payments.processing_timeout_occurred IS 'Indica se o lote sofreu um timeout ou erro de processamento parcial.';