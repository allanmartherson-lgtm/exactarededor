INSERT INTO public.payment_types (code, label, description, sort_order, active)
VALUES ('bonus_paciente', 'Bônus por paciente', 'Cada linha = um paciente atendido = bônus para o médico responsável. Sem cálculo de regra (pass-through).', 45, true)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order,
      active = true;