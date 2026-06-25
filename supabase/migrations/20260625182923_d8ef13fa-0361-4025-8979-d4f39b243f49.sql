
DELETE FROM public.payment_items
WHERE id IN (
  '2b440c6a-bd8e-4f50-91c2-84388a095232', -- TOTAL PARECER (37800)
  '8bf592f5-1408-48df-81b6-cf87e9187ade', -- DESCONTO DE FINAL DE SEMANA (10063.68)
  '354a622c-1c4d-42b9-b0f8-e707308a05af', -- DIVIDIDO POR 2
  '9680d245-9248-437a-8d11-6c84a00acc86', -- TOTAL VISITAS E PARECERES
  'b44e6055-205a-433b-815e-49b836e3d503', -- TOTAL
  'bb0c596f-b072-4fc7-ab2e-e4a0d26f88a1', -- TOTAL GERAL
  'e4a25da2-72cc-449e-bab3-e63e8e7341fb', -- TOTAL VISITA
  '2bc9d6a6-707f-47b5-94c4-2224900e7f0b', -- Cabeçalho empresa MORAIS no Paciente
  '7305a13b-2daa-4b93-8e6a-1f83f9684189', -- Cabeçalho empresa 2M no Paciente
  'a638080d-ed42-4bae-8ba3-40e58d600b48'  -- "MANUEL" sem valor
)
AND payment_id = 'd1c3b770-ef3f-4b5c-be45-13821683028e';
