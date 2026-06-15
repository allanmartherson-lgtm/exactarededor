
-- Aprovação de grupo (diretor)
ALTER TABLE public.company_group_approvals
  ADD COLUMN IF NOT EXISTS approval_source text NOT NULL DEFAULT 'system'
    CHECK (approval_source IN ('system','magic_link','email','whatsapp','outro')),
  ADD COLUMN IF NOT EXISTS approved_on_behalf_of text,
  ADD COLUMN IF NOT EXISTS external_evidence_path text,
  ADD COLUMN IF NOT EXISTS external_note text,
  ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.company_group_approvals.approval_source IS
  'Origem da aprovação: system (clique no app), magic_link (e-mail assinado), email/whatsapp/outro (registro manual de aprovação externa, backup ou transição).';
COMMENT ON COLUMN public.company_group_approvals.approved_on_behalf_of IS
  'Nome do diretor que aprovou externamente, quando approval_source != system/magic_link.';
COMMENT ON COLUMN public.company_group_approvals.registered_by IS
  'Usuário do sistema (analista) que registrou a aprovação externa. Para approval_source=system/magic_link é igual a approved_by.';

-- Validação do supervisor (mesma lógica)
ALTER TABLE public.production_validations
  ADD COLUMN IF NOT EXISTS validation_source text NOT NULL DEFAULT 'system'
    CHECK (validation_source IN ('system','email','whatsapp','outro')),
  ADD COLUMN IF NOT EXISTS validated_on_behalf_of text,
  ADD COLUMN IF NOT EXISTS external_evidence_path text,
  ADD COLUMN IF NOT EXISTS external_note text,
  ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.production_validations.validation_source IS
  'Origem da validação: system (clique no app) ou registro manual de validação externa (email/whatsapp/outro), usado como backup ou durante a transição.';
