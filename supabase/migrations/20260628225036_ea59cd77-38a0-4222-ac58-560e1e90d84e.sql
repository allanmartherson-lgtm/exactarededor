ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS has_mixed_parecer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mixed_parecer_payment_type_id uuid REFERENCES public.payment_types(id);

ALTER TABLE public.payment_types
  ADD COLUMN IF NOT EXISTS tuss_codes_extra text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.payments.has_mixed_parecer IS
  'Quando true, o lote (mesmo não sendo do tipo parecer/visita) contém atendimentos de parecer/visita misturados aos demais procedimentos. Liga o cruzamento com o relatório de parecer do Tasy só para os itens cujo TUSS bate em payment_types Parecer/Visita/Consulta.';

COMMENT ON COLUMN public.payments.mixed_parecer_payment_type_id IS
  'Subtipo de parecer aplicado aos itens cruzados quando has_mixed_parecer=true (ex.: parecer adulto vs pediátrico).';

COMMENT ON COLUMN public.payment_types.tuss_codes_extra IS
  'TUSS adicionais (além de tuss_default) que esse tipo de pagamento aceita. Usado para montar o conjunto de TUSS ambíguos no cruzamento de lote misto.';