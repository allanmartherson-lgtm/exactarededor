
-- 1. Soft-close columns em user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id);

-- 2. Substitui unique constraint por partial unique (apenas ativos)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_active_uidx
  ON public.user_roles (user_id, role)
  WHERE revoked_at IS NULL;

-- Índice auxiliar p/ has_role
CREATE INDEX IF NOT EXISTS user_roles_active_lookup_idx
  ON public.user_roles (user_id, role)
  WHERE revoked_at IS NULL;

-- 3. has_role passa a filtrar revoked_at IS NULL
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND revoked_at IS NULL
  )
$$;

-- 4. Aviso rastreável de revisão do baseline (visível para admins/diretores até 18/07/2026)
INSERT INTO public.system_announcements (title, message, severity, active, ends_at)
VALUES (
  'Revisão do baseline de permissões (prazo 18/07/2026)',
  'Foi criado um baseline de user_roles/user_hospitals em 11/07/2026 (audit_log: user_permissions_baseline_20260711). Admins devem revisar as permissões atuais até 18/07/2026 e confirmar que todas correspondem ao que está autorizado hoje. Registrar a conclusão da revisão como uma entrada de audit_log com action=''baseline_review_confirmed''.',
  'warning',
  true,
  '2026-07-18 23:59:59-03'::timestamptz
);
