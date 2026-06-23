-- Phase 2: Relatório de Parecer do Tasy
-- Tabelas para armazenar relatórios importados e suas linhas; campos de
-- evidência em payment_items para vincular item ↔ linha do parecer.

CREATE TABLE public.payment_parecer_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  source_filename text,
  source_file_hash text,
  row_count integer NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_parecer_reports TO authenticated;
GRANT ALL ON public.payment_parecer_reports TO service_role;

ALTER TABLE public.payment_parecer_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read parecer reports"
  ON public.payment_parecer_reports FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "auth insert parecer reports"
  ON public.payment_parecer_reports FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth update parecer reports"
  ON public.payment_parecer_reports FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete parecer reports"
  ON public.payment_parecer_reports FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_parecer_reports_payment ON public.payment_parecer_reports(payment_id);
CREATE INDEX idx_parecer_reports_period ON public.payment_parecer_reports(period_start, period_end);

CREATE TABLE public.payment_parecer_report_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.payment_parecer_reports(id) ON DELETE CASCADE,
  atendimento text,
  paciente text,
  medico_solicitante text,
  medico_resposta text,
  medico_resposta_crm text,
  espec_origem text,
  espec_destino text,
  dt_solic_parecer timestamptz,
  dt_resposta_parecer timestamptz,
  situacao text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_parecer_report_rows TO authenticated;
GRANT ALL ON public.payment_parecer_report_rows TO service_role;

ALTER TABLE public.payment_parecer_report_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read parecer rows"
  ON public.payment_parecer_report_rows FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "auth insert parecer rows"
  ON public.payment_parecer_report_rows FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "admin delete parecer rows"
  ON public.payment_parecer_report_rows FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_parecer_rows_report ON public.payment_parecer_report_rows(report_id);
CREATE INDEX idx_parecer_rows_match ON public.payment_parecer_report_rows(report_id, atendimento, medico_resposta_crm);
CREATE INDEX idx_parecer_rows_resposta ON public.payment_parecer_report_rows(dt_resposta_parecer);

-- Trigger updated_at no relatório
CREATE OR REPLACE FUNCTION public.tg_payment_parecer_reports_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_parecer_reports_updated_at
  BEFORE UPDATE ON public.payment_parecer_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_parecer_reports_updated_at();

-- Campos de evidência em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS parecer_evidence text
    CHECK (parecer_evidence IN ('confirmed','not_found','no_report')),
  ADD COLUMN IF NOT EXISTS parecer_report_row_id uuid
    REFERENCES public.payment_parecer_report_rows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parecer_evidence_weak boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parecer_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payment_items_parecer_evidence
  ON public.payment_items(payment_id, parecer_evidence)
  WHERE parecer_evidence IS NOT NULL;
