
-- Adicionar campos de cadastro estendido a profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS role_title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS birth_date date;

-- Tabela de solicitações de acesso (auto-cadastro pendente de aprovação)
CREATE TABLE IF NOT EXISTS public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  role_title text NOT NULL,
  department text NOT NULL,
  birth_date date NOT NULL,
  requested_roles text[] NOT NULL DEFAULT '{analista}',
  message text,
  status text NOT NULL DEFAULT 'pendente',
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON public.access_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_requests_pending_email
  ON public.access_requests(lower(email)) WHERE status = 'pendente';

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa (mesmo anônima) pode criar solicitação
CREATE POLICY ar_insert_anyone
  ON public.access_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'pendente');

-- Admin/diretor visualizam e gerenciam
CREATE POLICY ar_view_admin_diretor
  ON public.access_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

CREATE POLICY ar_update_admin_diretor
  ON public.access_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_access_requests_touch
BEFORE UPDATE ON public.access_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Atualizar handle_new_user para copiar campos extras vindos de user_metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role_title, department, birth_date)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'phone',''),
    NULLIF(NEW.raw_user_meta_data->>'role_title',''),
    NULLIF(NEW.raw_user_meta_data->>'department',''),
    NULLIF(NEW.raw_user_meta_data->>'birth_date','')::date
  );
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'diretor');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'analista');
  END IF;
  RETURN NEW;
END;
$function$;
