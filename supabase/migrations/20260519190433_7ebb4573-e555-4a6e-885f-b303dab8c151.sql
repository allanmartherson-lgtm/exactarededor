
CREATE TABLE public.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done','error')),
  file_name TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  conciliado INTEGER NOT NULL DEFAULT 0,
  valor_divergente INTEGER NOT NULL DEFAULT 0,
  so_hospital INTEGER NOT NULL DEFAULT 0,
  so_medpay INTEGER NOT NULL DEFAULT 0,
  risco_mais NUMERIC(12,2) NOT NULL DEFAULT 0,
  risco_menos NUMERIC(12,2) NOT NULL DEFAULT 0,
  divergencia_valor NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_reconciliation_runs_payment ON public.reconciliation_runs(payment_id);

CREATE TABLE public.reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  payment_item_id UUID REFERENCES public.payment_items(id),
  attendance_number TEXT,
  patient_name TEXT,
  procedure_code TEXT,
  procedure_name TEXT,
  doctor_name TEXT,
  procedure_date DATE,
  valor_medpay NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_hospital NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'conciliado' CHECK (status IN ('conciliado','valor_divergente','so_hospital','so_medpay')),
  ia_obs TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reconciliation_items_run ON public.reconciliation_items(run_id);
CREATE INDEX idx_reconciliation_items_status ON public.reconciliation_items(run_id, status);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_runs" ON public.reconciliation_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_items" ON public.reconciliation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public) VALUES ('reconciliation-files', 'reconciliation-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "recon_files_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'reconciliation-files');
CREATE POLICY "recon_files_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reconciliation-files');
CREATE POLICY "recon_files_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'reconciliation-files');
CREATE POLICY "recon_files_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'reconciliation-files');
