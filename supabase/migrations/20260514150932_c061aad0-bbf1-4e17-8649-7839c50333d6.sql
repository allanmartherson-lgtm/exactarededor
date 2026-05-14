-- 1. Atualizar a regra existente para Neurocirurgia/Crânio
UPDATE rules 
SET 
    name = 'Neurocirurgia/Crânio (200%)',
    rule_text = 'Repassar com a dobra (200%) os procedimentos de Neurocirurgia/Crânio conforme acordo contratual da DF Neuro.',
    extras_codes = ARRAY['3140*', '30715*', '30215021', '30215048', '31401155', '31401031', '31401171', '31401090'],
    convenio_percentage = 200,
    calculation_type = 'percentual_sobre_convenio',
    active = true,
    updated_at = now()
WHERE id = '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e';

-- 2. Criar a regra para Neurovascular/Hemodinâmica
INSERT INTO rules (
    id,
    name,
    rule_text,
    description,
    calculation_type,
    convenio_percentage,
    active,
    severity,
    scope,
    extras_codes,
    group_company_links,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'Neurovascular/Hemodinâmica (200%)',
    'Repassar com a dobra (200%) os procedimentos de Neurovascular/Hemodinâmica conforme acordo contratual da DF Neuro.',
    'Acordo de 200% para procedimentos realizados no setor de Hemodinâmica.',
    'percentual_sobre_convenio',
    200,
    true,
    'aviso',
    'grupo',
    ARRAY['40812*', '40902*', '30911*', '30912*'],
    '[{"company_id": "cec344d9-37ed-4466-bcaa-39599afa2161"}]'::jsonb,
    now(),
    now()
);