-- Corrige FK: payments.payment_model_id na verdade referencia o TIPO de item do lote
-- (Consulta/Parecer/Visita/Cirurgia), não o modelo de pagamento (Produção/Plantão/etc).
-- Todo o código consumidor (CompanyAnalysis, analyze-payment, parser, wizard)
-- já usa esse valor como payment_types.id. Repontar a FK.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_model_id_fkey;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_model_id_fkey
  FOREIGN KEY (payment_model_id) REFERENCES public.payment_types(id) ON DELETE SET NULL;