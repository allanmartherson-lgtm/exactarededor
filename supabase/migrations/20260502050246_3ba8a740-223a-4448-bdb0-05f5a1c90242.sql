-- Adiciona novos status ao enum payment_status para suportar
-- aprovação condicional do diretor e questionamento do recebedor da NF.
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'aprovado_com_ressalva';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'nf_questionada';