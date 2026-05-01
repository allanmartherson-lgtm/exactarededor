
-- =========== ENUMS ===========
CREATE TYPE public.app_role AS ENUM ('admin', 'diretor', 'validador', 'analista');

CREATE TYPE public.payment_status AS ENUM (
  'rascunho',
  'em_analise_ia',
  'aguardando_validacao',
  'devolvido_analista',
  'aguardando_aprovacao',
  'devolvido_validador',
  'aprovado',
  'pedido_nf_enviado',
  'nf_recebida',
  'nf_conciliada',
  'nf_divergente',
  'pago',
  'rejeitado'
);

CREATE TYPE public.item_ai_status AS ENUM ('pendente', 'aprovado', 'alerta', 'reprovado');
CREATE TYPE public.observation_author AS ENUM ('ia', 'analista', 'validador', 'diretor', 'sistema');
CREATE TYPE public.rule_severity AS ENUM ('info', 'aviso', 'bloqueio');
CREATE TYPE public.invoice_status AS ENUM ('aguardando', 'recebida', 'conciliada', 'divergente');

-- =========== PROFILES ===========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_all_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- =========== USER ROLES ===========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "roles_self_view" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "roles_admin_view_all" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========== TRIGGER: criar profile automaticamente ===========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  -- Primeiro usuário cadastrado vira admin automaticamente
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'diretor');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'analista');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========== updated_at trigger ===========
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========== RULES ===========
CREATE TABLE public.rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- regra estruturada em JSON; também guardamos texto livre que a IA usa de contexto
  rule_text TEXT NOT NULL,
  rule_json JSONB,
  severity public.rule_severity NOT NULL DEFAULT 'aviso',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rules_updated_at BEFORE UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules_view_authenticated" ON public.rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "rules_manage_admin_diretor" ON public.rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

-- =========== PAYMENTS ===========
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,                  -- nome/lote do pagamento
  description TEXT,
  status public.payment_status NOT NULL DEFAULT 'rascunho',
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  source_file_path TEXT,                    -- caminho no storage do arquivo original
  ai_summary TEXT,                          -- resumo geral da análise IA
  created_by UUID NOT NULL REFERENCES auth.users(id),
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  approval_pdf_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_view_authenticated" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert_analista" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND (
      public.has_role(auth.uid(), 'analista') OR
      public.has_role(auth.uid(), 'admin') OR
      public.has_role(auth.uid(), 'diretor')
    )
  );
CREATE POLICY "payments_update_workflow" ON public.payments FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(), 'analista') OR
  public.has_role(auth.uid(), 'validador') OR
  public.has_role(auth.uid(), 'diretor') OR
  public.has_role(auth.uid(), 'admin')
);

-- =========== PAYMENT ITEMS ===========
CREATE TABLE public.payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  doctor_document TEXT,                     -- CPF/CNPJ
  doctor_email TEXT,
  description TEXT,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ai_status public.item_ai_status NOT NULL DEFAULT 'pendente',
  ai_findings JSONB,                        -- {alerts:[...], matched_rules:[...]}
  raw_data JSONB,                           -- linha original importada
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "items_view_authenticated" ON public.payment_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "items_manage_workflow" ON public.payment_items FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista') OR
    public.has_role(auth.uid(), 'validador') OR
    public.has_role(auth.uid(), 'diretor') OR
    public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analista') OR
    public.has_role(auth.uid(), 'validador') OR
    public.has_role(auth.uid(), 'diretor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- =========== OBSERVATIONS (histórico) ===========
CREATE TABLE public.payment_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.payment_items(id) ON DELETE CASCADE,
  author_type public.observation_author NOT NULL,
  author_id UUID REFERENCES auth.users(id),
  message TEXT NOT NULL,
  status_from public.payment_status,
  status_to public.payment_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obs_view_authenticated" ON public.payment_observations FOR SELECT TO authenticated USING (true);
CREATE POLICY "obs_insert_workflow" ON public.payment_observations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'analista') OR
    public.has_role(auth.uid(), 'validador') OR
    public.has_role(auth.uid(), 'diretor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- =========== INVOICES (notas fiscais) ===========
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  upload_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  expected_amount NUMERIC(14,2) NOT NULL,
  received_amount NUMERIC(14,2),
  invoice_number TEXT,
  file_path TEXT,
  status public.invoice_status NOT NULL DEFAULT 'aguardando',
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  reconciliation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_view_authenticated" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_manage_workflow" ON public.invoices FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista') OR
    public.has_role(auth.uid(), 'validador') OR
    public.has_role(auth.uid(), 'diretor') OR
    public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analista') OR
    public.has_role(auth.uid(), 'validador') OR
    public.has_role(auth.uid(), 'diretor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- =========== STORAGE BUCKETS ===========
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-files', 'payment-files', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('approval-pdfs', 'approval-pdfs', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', false);

-- Authenticated users can read/write payment-files & approval-pdfs
CREATE POLICY "payment_files_auth_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('payment-files', 'approval-pdfs', 'invoices'));
CREATE POLICY "payment_files_auth_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('payment-files', 'approval-pdfs', 'invoices'));
CREATE POLICY "payment_files_auth_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('payment-files', 'approval-pdfs', 'invoices'));

-- Indexes
CREATE INDEX idx_items_payment ON public.payment_items(payment_id);
CREATE INDEX idx_obs_payment ON public.payment_observations(payment_id, created_at DESC);
CREATE INDEX idx_invoices_token ON public.invoices(upload_token);
CREATE INDEX idx_payments_status ON public.payments(status, created_at DESC);
