CREATE TABLE public.glosa_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  convenio text,
  competence_month text,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'processando' CHECK (status IN ('processando','concluido','erro')),
  total_items integer DEFAULT 0,
  matched_items integer DEFAULT 0,
  unmatched_items integer DEFAULT 0,
  total_glosa_amount numeric(12,2) DEFAULT 0,
  file_name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.glosa_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.glosa_batches(id) ON DELETE CASCADE,
  attendance_number text,
  procedure_code text,
  procedure_name text,
  procedure_date date,
  sector text,
  doctor_name text,
  doctor_crm text,
  patient_name text,
  convenio text,
  valor_cobrado numeric(12,2),
  valor_glosa numeric(12,2) NOT NULL DEFAULT 0,
  motivo_glosa text,
  complemento_glosa text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','vinculado','sem_match','aplicado','quitado','ignorado')),
  matched_payment_item_id uuid REFERENCES public.payment_items(id),
  matched_payment_id uuid REFERENCES public.payments(id),
  matched_company_name text,
  matched_at timestamptz,
  applied_at timestamptz,
  applied_payment_id uuid REFERENCES public.payments(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.glosa_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_crm text,
  doctor_name text NOT NULL,
  total_debt numeric(12,2) NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  last_payment_id uuid REFERENCES public.payments(id),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','quitado','parcial')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(doctor_crm, doctor_name)
);

CREATE TABLE public.glosa_debt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.glosa_debts(id) ON DELETE CASCADE,
  glosa_item_id uuid NOT NULL REFERENCES public.glosa_items(id),
  amount numeric(12,2) NOT NULL,
  applied_amount numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_glosa_items_attendance ON public.glosa_items(attendance_number);
CREATE INDEX idx_glosa_items_batch ON public.glosa_items(batch_id);
CREATE INDEX idx_glosa_items_status ON public.glosa_items(status);
CREATE INDEX idx_glosa_debts_crm ON public.glosa_debts(doctor_crm);
CREATE INDEX idx_glosa_debt_items_debt ON public.glosa_debt_items(debt_id);

ALTER TABLE public.glosa_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glosa_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glosa_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glosa_debt_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON public.glosa_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.glosa_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.glosa_debts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.glosa_debt_items FOR ALL TO authenticated USING (true) WITH CHECK (true);