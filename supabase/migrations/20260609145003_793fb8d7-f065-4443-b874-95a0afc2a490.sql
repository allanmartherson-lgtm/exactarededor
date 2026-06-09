-- Enum de classificação dos itens
DO $$ BEGIN
  CREATE TYPE public.retro_recon_classification AS ENUM (
    'ok_pago', 'pago_a_menos', 'nao_pago', 'pago_outro_mes', 'sem_lastro', 'pendente'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.retro_recon_status AS ENUM ('em_analise', 'concluida', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela pai
CREATE TABLE IF NOT EXISTS public.retroactive_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status public.retro_recon_status NOT NULL DEFAULT 'em_analise',
  title text,
  notes text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  adjustment_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  concluded_at timestamptz,
  CONSTRAINT retro_recon_period_chk CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_retro_recon_hospital ON public.retroactive_reconciliations(hospital_id);
CREATE INDEX IF NOT EXISTS idx_retro_recon_doctor ON public.retroactive_reconciliations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_retro_recon_status ON public.retroactive_reconciliations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retroactive_reconciliations TO authenticated;
GRANT ALL ON public.retroactive_reconciliations TO service_role;

ALTER TABLE public.retroactive_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retro_recon_select_hospital"
  ON public.retroactive_reconciliations FOR SELECT TO authenticated
  USING (
    hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
  );

CREATE POLICY "retro_recon_insert_hospital"
  ON public.retroactive_reconciliations FOR INSERT TO authenticated
  WITH CHECK (
    hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
  );

CREATE POLICY "retro_recon_update_hospital"
  ON public.retroactive_reconciliations FOR UPDATE TO authenticated
  USING (
    hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
  );

CREATE POLICY "retro_recon_delete_hospital"
  ON public.retroactive_reconciliations FOR DELETE TO authenticated
  USING (
    hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_retroactive_reconciliations()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_retro_recon ON public.retroactive_reconciliations;
CREATE TRIGGER trg_touch_retro_recon BEFORE UPDATE ON public.retroactive_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.touch_retroactive_reconciliations();

-- Tabela de itens
CREATE TABLE IF NOT EXISTS public.retroactive_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.retroactive_reconciliations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'form', -- form | upload | paste
  attendance text,
  tuss_code text,
  procedure_date date,
  patient_name text,
  function_label text,
  company_id uuid REFERENCES public.companies(id),
  claimed_amount numeric,
  paid_amount numeric,
  expected_amount numeric,
  gap_amount numeric,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  payment_item_id uuid REFERENCES public.payment_items(id) ON DELETE SET NULL,
  matched_payment_period daterange,
  classification public.retro_recon_classification NOT NULL DEFAULT 'pendente',
  classification_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_adjustment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retro_recon_items_parent ON public.retroactive_reconciliation_items(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_retro_recon_items_class ON public.retroactive_reconciliation_items(classification);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retroactive_reconciliation_items TO authenticated;
GRANT ALL ON public.retroactive_reconciliation_items TO service_role;

ALTER TABLE public.retroactive_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retro_recon_items_select"
  ON public.retroactive_reconciliation_items FOR SELECT TO authenticated
  USING (
    reconciliation_id IN (
      SELECT r.id FROM public.retroactive_reconciliations r
      WHERE r.hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
    )
  );

CREATE POLICY "retro_recon_items_insert"
  ON public.retroactive_reconciliation_items FOR INSERT TO authenticated
  WITH CHECK (
    reconciliation_id IN (
      SELECT r.id FROM public.retroactive_reconciliations r
      WHERE r.hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
    )
  );

CREATE POLICY "retro_recon_items_update"
  ON public.retroactive_reconciliation_items FOR UPDATE TO authenticated
  USING (
    reconciliation_id IN (
      SELECT r.id FROM public.retroactive_reconciliations r
      WHERE r.hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
    )
  );

CREATE POLICY "retro_recon_items_delete"
  ON public.retroactive_reconciliation_items FOR DELETE TO authenticated
  USING (
    reconciliation_id IN (
      SELECT r.id FROM public.retroactive_reconciliations r
      WHERE r.hospital_id IN (SELECT uh.hospital_id FROM public.user_hospitals uh WHERE uh.user_id = auth.uid())
    )
  );

DROP TRIGGER IF EXISTS trg_touch_retro_recon_items ON public.retroactive_reconciliation_items;
CREATE TRIGGER trg_touch_retro_recon_items BEFORE UPDATE ON public.retroactive_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_retroactive_reconciliations();