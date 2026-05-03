
-- Regras de exclusão: motivo + permissão de exceção autorizada
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS allows_authorized_exception boolean NOT NULL DEFAULT false;

-- Itens: permitir marcar exceção autorizada com rastreabilidade
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS authorized_exception boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_reason text,
  ADD COLUMN IF NOT EXISTS exception_authorizer text,
  ADD COLUMN IF NOT EXISTS exception_note text,
  ADD COLUMN IF NOT EXISTS exception_attachment_path text,
  ADD COLUMN IF NOT EXISTS exception_marked_by uuid,
  ADD COLUMN IF NOT EXISTS exception_marked_at timestamptz;
