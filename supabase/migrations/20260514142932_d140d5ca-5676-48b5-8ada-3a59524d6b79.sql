-- Adicionar coluna de palavras-chave nas regras
ALTER TABLE public.rule_calculations 
ADD COLUMN procedure_keywords TEXT[];

-- Criar uma regra Master Global para Neuro/Crânio
-- Isso garante que qualquer empresa que não tenha uma regra específica para esses códigos
-- ou que use novos códigos com essas palavras-chave receba o tratamento de 200%.
INSERT INTO public.rules (
    name, rule_text, severity, scope, active, calculation_type, 
    repasse_pct, description
) VALUES (
    'Master - Neurocirurgia/Crânio (200%)',
    'Procedimentos de neurocirurgia e crânio identificados por palavras-chave ou códigos específicos recebem 200% de repasse.',
    'info',
    'master',
    true,
    'percentual_sobre_convenio',
    200,
    'Regra global para garantir que procedimentos cranianos recebam a dobra de repasse (200%) em setores cirúrgicos/hemodinâmica.'
) RETURNING id;

-- O ID da regra acima será usado para inserir o cálculo.
-- Como não sei o ID exato gerado, vou usar um DO block ou subquery.
DO $$
DECLARE
    v_rule_id UUID;
BEGIN
    SELECT id INTO v_rule_id FROM public.rules WHERE name = 'Master - Neurocirurgia/Crânio (200%)' LIMIT 1;

    INSERT INTO public.rule_calculations (
        rule_id, label, sort_order, calculation_type, repasse_pct, 
        procedure_keywords, sectors, procedure_codes
    ) VALUES (
        v_rule_id,
        'Crânio/Neuro (Palavras-chave)',
        10,
        'percentual_sobre_convenio',
        200,
        ARRAY['cranio', 'craniana', 'microcirurgia', 'neurovascular', 'crânio', 'neuro'],
        ARRAY['cirurgia', 'hemodinamica'],
        ARRAY['31401155', '31401031', '31401171', '31401090', '40812030']
    );
END $$;
