ALTER TABLE public.rule_calculations
ADD COLUMN IF NOT EXISTS contagia_atendimento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rule_calculations.contagia_atendimento IS
'Quando true e a linha de calculo for do tipo exclusao: ao disparar exclusao para um item, todos os demais itens do mesmo (atendimento, data) sao excluidos (pagamento zerado). Excecao: se existir pelo menos 1 item do atendimento cujo medico pertenca a lista de medicos da regra (rule.doctors), o atendimento inteiro e poupado do contagio.';