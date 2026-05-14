-- 1. Desativar a regra redundante (Neurovascular)
UPDATE public.rules 
SET active = false 
WHERE id = '3755c64c-79d6-49dc-9c36-59b3c8dc5264';

-- 2. Atualizar a regra principal (Neurocirurgia -> DF Neuro Global)
UPDATE public.rules
SET 
    name = 'DF Neuro - Acordo 200% (Crânio e Hemodinâmica)',
    group_company_links = '[{"company_id": "cec344d9-37ed-4466-bcaa-39599afa2161"}]'::jsonb,
    updated_at = now()
WHERE id = '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e';

-- 3. Atualizar os cálculos da regra principal
-- Remover cálculos antigos e inserir os novos unificados
DELETE FROM public.rule_calculations WHERE rule_id = '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e';

INSERT INTO public.rule_calculations (
    id, rule_id, sort_order, label, calculation_type, convenio_percentage, 
    procedure_codes, code_match_mode, sectors, has_conditions
) VALUES (
    'e777034b-318d-4712-a894-a1c07c9bc7e8', 
    '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e', 
    0, 
    'Acordo Dobra (200%)', 
    'percentual_sobre_convenio', 
    200, 
    ARRAY[
        '31401155', '31401031', '31401171', '31401090', '40812030', '31401147', '31401163', 
        '31401180', '31401198', '31401201', '31401210', '31401228', '31401236', '31401244', 
        '31401252', '31401260', '31401279', '31401287', '31401295', '31401309', '31401317', 
        '31401325', '31401333', '31403018', '31403026', '31403034', '31403042', '31403132', 
        '31403140', '31403159', '31403167', '31403175', '31403183', '31403191', '31403205', 
        '31403213', '40812057', '40813789', '40913061', '40813541', '40813193', '40813061', 
        '40813568', '30908035', '40813576', '40813207', '40813070', '3140*'
    ], 
    'whitelist', 
    ARRAY['cirurgia', 'hemodinamica'],
    true
), (
    'bd858426-b728-4c85-9869-d55c8da92dff', 
    '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e', 
    1, 
    'Demais Procedimentos (100%)', 
    'percentual_sobre_convenio', 
    100, 
    NULL, 
    'any', 
    NULL,
    false
);
