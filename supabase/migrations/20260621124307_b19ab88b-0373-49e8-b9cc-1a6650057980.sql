-- Adiciona motivos de cancelamento que distinguem economia real de operações neutras
-- (transferência para outro lote, duplicidade corrigida pelo motor).
-- ALTER TYPE ADD VALUE precisa rodar fora de transação implícita; cada ADD VALUE é idempotente via IF NOT EXISTS.
ALTER TYPE public.payment_cancellation_reason ADD VALUE IF NOT EXISTS 'economia_real';
ALTER TYPE public.payment_cancellation_reason ADD VALUE IF NOT EXISTS 'pago_em_outro_lote';
ALTER TYPE public.payment_cancellation_reason ADD VALUE IF NOT EXISTS 'duplicidade_motor';