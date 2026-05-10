ALTER TABLE public.payment_items 
ADD COLUMN convenio_value_totalized BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_items.convenio_value_totalized IS 'Se verdadeiro, o campo procedure_amount já contém o valor total (Unitário * Qtd), então o motor não deve multiplicar novamente.';