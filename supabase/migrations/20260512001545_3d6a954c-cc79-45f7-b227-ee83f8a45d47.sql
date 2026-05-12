-- Adiciona campo force_totalized na tabela de regras
ALTER TABLE public.rules 
ADD COLUMN force_totalized BOOLEAN DEFAULT false;

-- Adiciona campo force_totalized nos itens de cálculo (1:N)
ALTER TABLE public.rule_calculations
ADD COLUMN force_totalized BOOLEAN DEFAULT false;

-- Comentários para documentação
COMMENT ON COLUMN public.rules.force_totalized IS 'Se verdadeiro, o motor ignora a coluna quantidade do item de pagamento e considera o valor calculado como o total final.';
COMMENT ON COLUMN public.rule_calculations.force_totalized IS 'Se verdadeiro, este item de cálculo específico ignora a quantidade e considera o valor calculado como total.';