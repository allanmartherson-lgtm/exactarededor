-- ============================================================================
-- 1. CLEANUP: reverter excedentes em débitos sobre-aplicados
-- ============================================================================
-- Para cada débito, ordenamos as aplicações ATIVAS por created_at ASC e
-- marcamos como 'revertido' aquelas cuja soma cumulativa ultrapasse total_debt.
WITH ativos AS (
  SELECT
    gpa.id,
    gpa.glosa_debt_id,
    gpa.valor_aplicado,
    gpa.applied_at,
    gd.total_debt,
    SUM(gpa.valor_aplicado) OVER (
      PARTITION BY gpa.glosa_debt_id
      ORDER BY gpa.applied_at ASC, gpa.id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_sum,
    SUM(gpa.valor_aplicado) OVER (
      PARTITION BY gpa.glosa_debt_id
      ORDER BY gpa.applied_at ASC, gpa.id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_sum
  FROM public.glosa_payment_applications gpa
  JOIN public.glosa_debts gd ON gd.id = gpa.glosa_debt_id
  WHERE gpa.status IN ('proposto','confirmado','partial')
    AND gpa.valor_aplicado > 0
),
to_revert AS (
  SELECT id
  FROM ativos
  WHERE COALESCE(prev_sum, 0) >= total_debt - 0.005
)
UPDATE public.glosa_payment_applications gpa
SET status = 'revertido',
    resolution_note = COALESCE(gpa.resolution_note || ' | ', '')
      || 'Revertido em ' || to_char(now(), 'YYYY-MM-DD') || ' (cleanup duplicidade)'
FROM to_revert
WHERE gpa.id = to_revert.id
  AND EXISTS (SELECT 1 FROM public.payments p WHERE p.id = gpa.payment_id);

-- ============================================================================
-- 2. AUTO-ARQUIVAMENTO: função + gatilho
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_glosa_debt_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt_id UUID;
  v_total NUMERIC;
  v_applied NUMERIC;
BEGIN
  v_debt_id := COALESCE(NEW.glosa_debt_id, OLD.glosa_debt_id);
  IF v_debt_id IS NULL THEN RETURN NULL; END IF;

  SELECT total_debt INTO v_total FROM public.glosa_debts WHERE id = v_debt_id;
  IF v_total IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0) INTO v_applied
  FROM public.glosa_payment_applications
  WHERE glosa_debt_id = v_debt_id
    AND status IN ('proposto','confirmado','partial');

  IF v_applied >= v_total - 0.005 THEN
    UPDATE public.glosa_debts
    SET status = 'quitado', updated_at = now()
    WHERE id = v_debt_id AND status <> 'quitado';
  ELSE
    UPDATE public.glosa_debts
    SET status = 'ativo', updated_at = now()
    WHERE id = v_debt_id AND status = 'quitado';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_glosa_debt_status ON public.glosa_payment_applications;
CREATE TRIGGER trg_recompute_glosa_debt_status
AFTER INSERT OR UPDATE OR DELETE ON public.glosa_payment_applications
FOR EACH ROW EXECUTE FUNCTION public.recompute_glosa_debt_status();

-- Reprocessa status agora, para pegar os 40 débitos quitados que ficaram "ativos".
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT gd.id, gd.total_debt,
      COALESCE((SELECT SUM(valor_aplicado) FROM public.glosa_payment_applications
                WHERE glosa_debt_id = gd.id
                  AND status IN ('proposto','confirmado','partial')), 0) AS applied
    FROM public.glosa_debts gd
  LOOP
    IF r.applied >= r.total_debt - 0.005 THEN
      UPDATE public.glosa_debts SET status='quitado', updated_at=now()
        WHERE id=r.id AND status <> 'quitado';
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 3. ÍNDICE ÚNICO PARCIAL: impede novas duplicatas por (débito, lote, parcela)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpa_debt_payment_parcela_ativas
  ON public.glosa_payment_applications (glosa_debt_id, payment_id, parcela_numero)
  WHERE status IN ('proposto','confirmado','partial');

-- ============================================================================
-- 4. TABELA DE TRAVA para serializar execuções concorrentes de apply-company-deductions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deduction_run_locks (
  payment_id UUID NOT NULL,
  company_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '2 minutes'),
  hospital_id UUID,
  PRIMARY KEY (payment_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deduction_run_locks TO authenticated;
GRANT ALL ON public.deduction_run_locks TO service_role;
ALTER TABLE public.deduction_run_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages locks"
  ON public.deduction_run_locks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- RPC de aquisição/liberação
CREATE OR REPLACE FUNCTION public.try_acquire_deduction_lock(
  _payment_id UUID, _company_id UUID, _hospital_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Limpa travas expiradas primeiro
  DELETE FROM public.deduction_run_locks
    WHERE payment_id = _payment_id AND company_id = _company_id
      AND expires_at < now();

  BEGIN
    INSERT INTO public.deduction_run_locks(payment_id, company_id, hospital_id)
    VALUES (_payment_id, _company_id, _hospital_id);
    RETURN TRUE;
  EXCEPTION WHEN unique_violation THEN
    RETURN FALSE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_deduction_lock(
  _payment_id UUID, _company_id UUID
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.deduction_run_locks
    WHERE payment_id = _payment_id AND company_id = _company_id;
$$;

GRANT EXECUTE ON FUNCTION public.try_acquire_deduction_lock(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_deduction_lock(UUID, UUID) TO authenticated, service_role;
