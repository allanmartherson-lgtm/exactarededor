-- Restaurar 2 pagamentos que foram enviados para validação mas o status foi
-- revertido por uma reanálise concorrente.
UPDATE public.payment_company_groups
SET status = 'aguardando_validacao'
WHERE id IN ('72dc26c0-b02c-4183-8cc7-5ee9cf77e1d0', '544678fb-7466-4ecd-b1dc-95fa85fefd90')
  AND status = 'revisao_analista';

-- O trigger recompute_payment_status_from_groups vai propagar para payments.
INSERT INTO public.payment_observations (payment_id, author_type, message, status_from, status_to)
VALUES
  ('817befbe-6b81-479e-b2c5-7264ef3efc40', 'sistema',
   'Correção automática: status restaurado para aguardando_validacao após corrida com reanálise da IA.',
   'revisao_analista', 'aguardando_validacao'),
  ('96552320-f49a-48ed-8f80-82239625e566', 'sistema',
   'Correção automática: status restaurado para aguardando_validacao após corrida com reanálise da IA.',
   'revisao_analista', 'aguardando_validacao');