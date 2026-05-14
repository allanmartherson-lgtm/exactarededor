UPDATE rule_calculations 
SET code_match_mode = 'whitelist'
WHERE rule_id IN (
    '6ed63183-9a7d-4b0b-8422-ef36e8b4c06e',
    (SELECT id FROM rules WHERE name = 'Neurovascular/Hemodinâmica (200%)')
);