-- Remover atribuição individual de validador. Validação volta a ser fila coletiva.

-- 1. Drop colunas de assignment em payment_company_groups (constraint + índices vão junto via CASCADE/auto)
ALTER TABLE public.payment_company_groups
  DROP CONSTRAINT IF EXISTS pcg_assignment_xor;

DROP INDEX IF EXISTS public.idx_pcg_assigned_validator;
DROP INDEX IF EXISTS public.idx_pcg_assigned_validator_group;

ALTER TABLE public.payment_company_groups
  DROP COLUMN IF EXISTS assigned_validator_id,
  DROP COLUMN IF EXISTS assigned_validator_group_id;

-- 2. Drop função auxiliar
DROP FUNCTION IF EXISTS public.is_in_validator_group(uuid, uuid);

-- 3. Drop tabelas de grupo (RLS policies caem junto)
DROP TABLE IF EXISTS public.validator_group_members;
DROP TABLE IF EXISTS public.validator_groups;