
-- Append-only financial journal
CREATE TABLE public.financial_journal (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL,
  sinal SMALLINT NOT NULL CHECK (sinal IN (-1, 1)),
  valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  payment_id UUID,
  payment_item_id UUID,
  company_id UUID,
  doctor_id UUID,
  cost_center_id UUID,
  competencia DATE,
  referencia TEXT,
  reverses_entry_id UUID REFERENCES public.financial_journal(id),
  reversed_by_entry_id UUID REFERENCES public.financial_journal(id),
  reason TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fj_payment ON public.financial_journal(payment_id);
CREATE INDEX idx_fj_company ON public.financial_journal(company_id);
CREATE INDEX idx_fj_doctor ON public.financial_journal(doctor_id);
CREATE INDEX idx_fj_competencia ON public.financial_journal(competencia);
CREATE INDEX idx_fj_tipo ON public.financial_journal(tipo);
CREATE INDEX idx_fj_created_at ON public.financial_journal(created_at DESC);

GRANT SELECT ON public.financial_journal TO authenticated;
GRANT ALL ON public.financial_journal TO service_role;

ALTER TABLE public.financial_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read journal"
ON public.financial_journal FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role manages journal"
ON public.financial_journal FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- Block updates/deletes to enforce append-only
CREATE OR REPLACE FUNCTION public.financial_journal_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial_journal is append-only; use reverse_journal_entry to reverse';
END;
$$;

CREATE TRIGGER trg_fj_no_update
BEFORE UPDATE ON public.financial_journal
FOR EACH ROW
WHEN (OLD.reversed_by_entry_id IS NOT DISTINCT FROM NEW.reversed_by_entry_id)
EXECUTE FUNCTION public.financial_journal_block_mutation();

CREATE TRIGGER trg_fj_no_delete
BEFORE DELETE ON public.financial_journal
FOR EACH ROW
EXECUTE FUNCTION public.financial_journal_block_mutation();

-- Idempotent record function
CREATE OR REPLACE FUNCTION public.record_journal_entry(
  p_operation_id TEXT,
  p_tipo TEXT,
  p_sinal SMALLINT,
  p_valor NUMERIC,
  p_payment_id UUID DEFAULT NULL,
  p_payment_item_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL,
  p_cost_center_id UUID DEFAULT NULL,
  p_competencia DATE DEFAULT NULL,
  p_referencia TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.financial_journal WHERE operation_id = p_operation_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.financial_journal(
    operation_id, tipo, sinal, valor, payment_id, payment_item_id,
    company_id, doctor_id, cost_center_id, competencia, referencia,
    reason, context, created_by
  ) VALUES (
    p_operation_id, p_tipo, p_sinal, p_valor, p_payment_id, p_payment_item_id,
    p_company_id, p_doctor_id, p_cost_center_id, p_competencia, p_referencia,
    p_reason, p_context, p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Reverse a previous entry
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_entry_id UUID,
  p_reason TEXT,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig public.financial_journal%ROWTYPE;
  v_new_id UUID;
  v_op TEXT;
BEGIN
  SELECT * INTO v_orig FROM public.financial_journal WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal entry % not found', p_entry_id;
  END IF;
  IF v_orig.reversed_by_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'entry % already reversed', p_entry_id;
  END IF;

  v_op := 'reverse:' || v_orig.operation_id;

  INSERT INTO public.financial_journal(
    operation_id, tipo, sinal, valor, payment_id, payment_item_id,
    company_id, doctor_id, cost_center_id, competencia, referencia,
    reverses_entry_id, reason, context, created_by
  ) VALUES (
    v_op, v_orig.tipo || '_reversal', (v_orig.sinal * -1)::SMALLINT, v_orig.valor,
    v_orig.payment_id, v_orig.payment_item_id, v_orig.company_id, v_orig.doctor_id,
    v_orig.cost_center_id, v_orig.competencia, v_orig.referencia,
    v_orig.id, p_reason, v_orig.context, p_created_by
  )
  RETURNING id INTO v_new_id;

  -- mark original (bypass trigger via direct update of reversed_by only — trigger allows it)
  UPDATE public.financial_journal
  SET reversed_by_entry_id = v_new_id
  WHERE id = v_orig.id;

  RETURN v_new_id;
END;
$$;

-- Balance helper
CREATE OR REPLACE FUNCTION public.get_journal_balance(
  p_doctor_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_competencia_from DATE DEFAULT NULL,
  p_competencia_to DATE DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(sinal * valor), 0)
  FROM public.financial_journal
  WHERE (p_doctor_id IS NULL OR doctor_id = p_doctor_id)
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_competencia_from IS NULL OR competencia >= p_competencia_from)
    AND (p_competencia_to IS NULL OR competencia <= p_competencia_to);
$$;
