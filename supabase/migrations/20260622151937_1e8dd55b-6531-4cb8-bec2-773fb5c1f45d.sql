-- ============================================================
-- ETAPA 1: Cadastro de Tipos de Pagamento + vínculos
-- ============================================================

-- 1) Estende payment_types com metadados de governança do fluxo
ALTER TABLE public.payment_types
  ADD COLUMN IF NOT EXISTS tuss_default text,
  ADD COLUMN IF NOT EXISTS requires_tuss_in_sheet boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_function text,
  ADD COLUMN IF NOT EXISTS default_value_column_hint text,
  ADD COLUMN IF NOT EXISTS expected_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allow_mixed_subtypes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subtype_split_hint jsonb,
  ADD COLUMN IF NOT EXISTS category text;

-- 2) Vincula payment_type_id em rules / payments / payment_items
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS rules_payment_type_idx
  ON public.rules(payment_type_id) WHERE payment_type_id IS NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payments_payment_type_id_idx
  ON public.payments(payment_type_id) WHERE payment_type_id IS NOT NULL;

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payment_items_payment_type_id_idx
  ON public.payment_items(payment_type_id) WHERE payment_type_id IS NOT NULL;

-- 3) Seed inicial dos tipos Rede D'Or (idempotente por code)
INSERT INTO public.payment_types
  (code, label, category, sort_order, tuss_default, requires_tuss_in_sheet, default_function,
   default_value_column_hint, expected_headers, allow_mixed_subtypes, subtype_split_hint, description)
VALUES
  ('parecer_adulto', 'Parecer Adulto', 'Parecer', 10,
   '10102019', false, 'Parecerista',
   'Valor a repassar',
   '["Atend.","Paciente","Dt. Solic.","Medico Solic.","Espec. orig.","Espec. dest.","Dt. Resp. Par.","Médico Parecerista","Convênio","Repasse","Valor a repassar"]'::jsonb,
   true,
   '{"column":"Medico Solic.","patterns":[{"match":"visita","target_code":"visita"}]}'::jsonb,
   'Pareceres médicos hospitalares — TUSS 10102019, valor fixo ou conforme regra cadastrada.'),
  ('visita', 'Visita', 'Visita', 20,
   '10102019', false, 'Visitador',
   'Valor a repassar', '[]'::jsonb, false, NULL,
   'Visitas hospitalares — compartilha TUSS com parecer; regra diferenciada.'),
  ('cirurgia', 'Cirurgia', 'Cirurgia', 30,
   NULL, true, 'Cirurgião Principal',
   NULL, '[]'::jsonb, false, NULL,
   'Procedimentos cirúrgicos — TUSS obrigatório na base.'),
  ('consulta', 'Consulta', 'Consulta', 40,
   NULL, false, 'Consultor',
   'Valor', '[]'::jsonb, false, NULL,
   'Consultas ambulatoriais.'),
  ('sadt', 'Exames SADT', 'Exames', 50,
   NULL, true, NULL,
   NULL, '[]'::jsonb, false, NULL,
   'Serviços auxiliares de diagnóstico e terapia.'),
  ('exames_cardiologia', 'Exames Cardiologia', 'Exames', 60,
   NULL, true, NULL,
   NULL, '[]'::jsonb, false, NULL,
   'Exames específicos de cardiologia (ECG, ECO, ergometria, etc.).')
ON CONFLICT (code) DO NOTHING;