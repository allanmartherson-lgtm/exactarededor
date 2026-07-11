-- Amplia status permitidos em glosa_payment_applications para incluir
-- 'postponed' (parcela adiada por líquido insuficiente no lote) e
-- 'partial' (parcela aplicada parcialmente; saldo remanescente rola para próximo lote).
ALTER TABLE public.glosa_payment_applications
  DROP CONSTRAINT IF EXISTS glosa_payment_applications_status_check;

ALTER TABLE public.glosa_payment_applications
  ADD CONSTRAINT glosa_payment_applications_status_check
  CHECK (status = ANY (ARRAY[
    'proposto'::text,
    'confirmado'::text,
    'revertido'::text,
    'pending_manual_resolution'::text,
    'postponed'::text,
    'partial'::text
  ]));

-- Motivo de postergação/parcial (livre — ex: 'insufficient_net', 'partial_capacity').
ALTER TABLE public.glosa_payment_applications
  ADD COLUMN IF NOT EXISTS postpone_reason text;