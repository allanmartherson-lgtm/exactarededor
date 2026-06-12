
-- Campos novos em payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS import_mode text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'fluxo',
  ADD COLUMN IF NOT EXISTS historico_window_start date,
  ADD COLUMN IF NOT EXISTS historico_window_end date;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_import_mode_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_import_mode_check CHECK (import_mode IN ('normal','historico'));

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_origem_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_origem_check CHECK (origem IN ('fluxo','historico'));

CREATE INDEX IF NOT EXISTS idx_payments_import_mode ON public.payments(import_mode) WHERE import_mode <> 'normal';
CREATE INDEX IF NOT EXISTS idx_payments_origem ON public.payments(origem) WHERE origem <> 'fluxo';

-- Flag analista sênior
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_senior boolean NOT NULL DEFAULT false;

-- Trigger: valida janela de competência e bloqueia mudanças de status em histórico
CREATE OR REPLACE FUNCTION public.trg_payments_historico_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start date := DATE '2026-01-01';
  v_window_end   date := DATE '2026-04-30';
  v_comp date;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.import_mode = 'historico' THEN
    v_comp := COALESCE(NEW.competence_month, (NEW.competence_months)[1]);
    IF v_comp IS NULL OR v_comp < v_window_start OR v_comp > v_window_end THEN
      RAISE EXCEPTION 'Importação histórica exige competência entre % e % (recebido: %)',
        v_window_start, v_window_end, v_comp;
    END IF;
    NEW.historico_window_start := v_window_start;
    NEW.historico_window_end   := v_window_end;
    NEW.origem := 'historico';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.import_mode = 'historico' THEN
    -- congela origem e import_mode
    IF NEW.import_mode <> OLD.import_mode THEN
      RAISE EXCEPTION 'Não é possível alterar import_mode de um pagamento histórico';
    END IF;
    IF NEW.origem <> OLD.origem THEN
      RAISE EXCEPTION 'Não é possível alterar origem de um pagamento histórico';
    END IF;
    -- só permite status pago / arquivado / cancelado / em_analise_ia (durante motor)
    IF NEW.status::text NOT IN ('em_analise_ia','pago','arquivado','cancelado','rascunho') THEN
      RAISE EXCEPTION 'Pagamento histórico só pode ficar em status pago/arquivado/cancelado (tentativa: %)', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_historico_guard ON public.payments;
CREATE TRIGGER trg_payments_historico_guard
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_payments_historico_guard();

-- Helper para edge functions e UI
CREATE OR REPLACE FUNCTION public.is_payment_historico(p_payment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT import_mode = 'historico' FROM public.payments WHERE id = p_payment_id), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_payment_historico(uuid) TO authenticated, anon, service_role;
