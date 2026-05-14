-- Limpar cálculos antigos para a DF Neuro (segurança)
DELETE FROM rule_calculations 
WHERE rule_id IN (
    '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e',
    (SELECT id FROM rules WHERE name = 'Neurovascular/Hemodinâmica (200%)')
);

-- 1. Garantir que a regra de Crânio existe e está correta
UPDATE rules 
SET 
    name = 'Neurocirurgia/Crânio (200%)',
    rule_text = 'Repassar com a dobra (200%) os procedimentos de Neurocirurgia/Crânio.',
    calculation_type = 'percentual_sobre_convenio',
    convenio_percentage = 200,
    extras_codes = NULL, -- Movendo para cálculos
    updated_at = now()
WHERE id = '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e';

-- 2. Criar item de cálculo para Crânio
INSERT INTO rule_calculations (
    id, rule_id, sort_order, label, calculation_type, 
    convenio_percentage, sectors, procedure_codes, has_conditions
) VALUES (
    gen_random_uuid(), '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e', 1, 'Neurocirurgia/Crânio', 
    'percentual_sobre_convenio', 200, ARRAY['cirurgia'], 
    ARRAY['3140*', '30715*', '30215021', '30215048', '31401155', '31401031', '31401171', '31401090'],
    true
);

-- 3. Garantir que a regra de Hemodinâmica existe
DO $$
DECLARE
    hemo_rule_id UUID;
BEGIN
    SELECT id INTO hemo_rule_id FROM rules WHERE name = 'Neurovascular/Hemodinâmica (200%)';
    
    IF hemo_rule_id IS NULL THEN
        INSERT INTO rules (
            id, name, rule_text, calculation_type, convenio_percentage, 
            active, severity, scope, group_company_links, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), 'Neurovascular/Hemodinâmica (200%)', 
            'Repassar com a dobra (200%) os procedimentos de Hemodinâmica.',
            'percentual_sobre_convenio', 200, true, 'aviso', 'grupo',
            '[{"company_id": "cec344d9-37ed-4466-bcaa-39599afa2161"}]'::jsonb,
            now(), now()
        ) RETURNING id INTO hemo_rule_id;
    END IF;

    -- Criar item de cálculo para Hemodinâmica
    INSERT INTO rule_calculations (
        id, rule_id, sort_order, label, calculation_type, 
        convenio_percentage, sectors, procedure_codes, has_conditions
    ) VALUES (
        gen_random_uuid(), hemo_rule_id, 1, 'Neurovascular/Hemodinâmica', 
        'percentual_sobre_convenio', 200, ARRAY['hemodinamica'], 
        ARRAY['40812*', '40902*', '30911*', '30912*'],
        true
    );
END $$;