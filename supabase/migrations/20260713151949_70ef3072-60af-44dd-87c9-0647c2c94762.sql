-- Cache de IA por hash de entrada (short-circuit)
-- Estratégia: quando o mesmo item é reanalisado, se o hash da entrada exata
-- enviada à IA (payload canônico + resultado do motor + rules.updated_at +
-- AI_PROMPT_VERSION + digest dos irmãos do atendimento) bater com o hash de
-- um item já analisado, pulamos a chamada da IA e reusamos ai_findings.ai.

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS ai_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS ai_cached_at TIMESTAMPTZ;

-- Índice para lookup rápido do cache (só faz sentido quando o item tem
-- ai_findings.ai populado — cache hits só reusam análises reais anteriores).
CREATE INDEX IF NOT EXISTS idx_payment_items_ai_input_hash
  ON public.payment_items (ai_input_hash)
  WHERE ai_input_hash IS NOT NULL;

-- Telemetria: quantos itens foram servidos do cache (economia de créditos IA).
ALTER TABLE public.analysis_telemetry
  ADD COLUMN IF NOT EXISTS ai_items_skipped_cache INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payment_items.ai_input_hash IS
  'SHA-256 do payload canônico enviado à IA (item + resultado do motor + siblings digest + rules.updated_at + AI_PROMPT_VERSION). Serve como chave de cache: se um item futuro tiver hash idêntico, reusamos ai_findings.ai sem chamar a IA. Ver supabase/functions/_shared/aiInputHash.ts.';

COMMENT ON COLUMN public.payment_items.ai_cached_at IS
  'Timestamp em que este item teve ai_findings.ai gerado (real ou reusado). Usado para diagnosticar cache hits.';

COMMENT ON COLUMN public.analysis_telemetry.ai_items_skipped_cache IS
  'Quantidade de itens que teriam ido à IA mas foram servidos pelo cache determinístico (ai_input_hash idêntico).';