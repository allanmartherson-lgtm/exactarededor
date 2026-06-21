ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS applied_calc_method_valid;
ALTER TABLE public.payment_items ADD CONSTRAINT applied_calc_method_valid CHECK (
  applied_calc_method IS NULL OR applied_calc_method = ANY (ARRAY[
    'percentual_convenio'::text,
    'regra_vias'::text,
    'pacote'::text,
    'valor_fixo'::text,
    'tabela_diferenciada'::text,
    'bonus'::text,
    'complemento'::text,
    'exclusao'::text,
    'bonus_paciente_passthrough'::text
  ])
);