INSERT INTO public.manual_intervention_reasons
  (code, label, category, description, financial_impact, applies_to, is_seed, sort_order)
VALUES
  ('ajuste_calculo_economia', 'Ajuste de cálculo errado (economia)', 'aceite_financeiro',
   'Cálculo da regra estava incorreto e o valor pago era MAIOR que o correto. Ajuste gera economia para o hospital.',
   'economia', '{acatar,editar}', true, 18),
  ('ajuste_calculo_perda',    'Ajuste de cálculo errado (perda)',    'aceite_financeiro',
   'Cálculo da regra estava incorreto e o valor pago era MENOR que o correto. Ajuste gera perda (complemento) para o hospital.',
   'perda',    '{acatar,editar}', true, 27)
ON CONFLICT (code) WHERE hospital_id IS NULL DO NOTHING;