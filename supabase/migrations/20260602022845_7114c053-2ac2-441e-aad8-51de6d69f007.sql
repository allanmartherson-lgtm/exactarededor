-- Adiciona CPF e flag de ativação ao perfil
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- CPF apenas dígitos (11). Mantém NULL permitido para perfis legados,
-- mas força o formato quando preenchido.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_cpf_format_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_cpf_format_chk
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

-- Unicidade do CPF entre usuários (case-insensitive não se aplica — só dígitos)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_cpf_unique_idx
  ON public.profiles (cpf)
  WHERE cpf IS NOT NULL;

-- Índice para busca textual (nome/email)
CREATE INDEX IF NOT EXISTS profiles_full_name_lower_idx
  ON public.profiles (lower(full_name));
CREATE INDEX IF NOT EXISTS profiles_email_lower_idx
  ON public.profiles (lower(email));