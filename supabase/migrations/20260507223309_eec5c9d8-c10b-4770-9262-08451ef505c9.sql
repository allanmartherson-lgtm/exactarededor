-- 1. Adiciona o status 'lancado' ao enum payment_status
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'lancado';
