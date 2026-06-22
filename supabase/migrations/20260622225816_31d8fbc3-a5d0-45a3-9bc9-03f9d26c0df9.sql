-- Exceção do cálculo por item: permite ao analista pular cálculos tipados
-- (rule_calculations.payment_type_id setado) para um item específico,
-- forçando o motor a cair no próximo cálculo elegível da mesma regra.

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS calc_exception_skip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calc_exception_reason text NULL,
  ADD COLUMN IF NOT EXISTS calc_exception_marked_by uuid NULL,
  ADD COLUMN IF NOT EXISTS calc_exception_marked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS calc_exception_skipped_calc_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_payment_items_calc_exception_skip
  ON public.payment_items(calc_exception_skip)
  WHERE calc_exception_skip = true;

-- Trigger: ao desligar a exceção, limpar os campos auxiliares para não deixar lixo.
CREATE OR REPLACE FUNCTION public.tg_payment_items_sanitize_calc_exception()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.calc_exception_skip IS DISTINCT FROM true THEN
    NEW.calc_exception_skip := false;
    NEW.calc_exception_reason := NULL;
    NEW.calc_exception_marked_by := NULL;
    NEW.calc_exception_marked_at := NULL;
    NEW.calc_exception_skipped_calc_id := NULL;
  ELSE
    -- ao ligar, garantir timestamp
    IF NEW.calc_exception_marked_at IS NULL THEN
      NEW.calc_exception_marked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_sanitize_calc_exception ON public.payment_items;
CREATE TRIGGER trg_payment_items_sanitize_calc_exception
  BEFORE INSERT OR UPDATE OF
    calc_exception_skip,
    calc_exception_reason,
    calc_exception_marked_by,
    calc_exception_marked_at,
    calc_exception_skipped_calc_id
  ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_payment_items_sanitize_calc_exception();

COMMENT ON COLUMN public.payment_items.calc_exception_skip IS
  'Quando true, o motor pula cálculos com payment_type_id setado na regra resolvida deste item e cai no próximo cálculo elegível (ex.: percentual_convenio). Marcação manual do analista.';