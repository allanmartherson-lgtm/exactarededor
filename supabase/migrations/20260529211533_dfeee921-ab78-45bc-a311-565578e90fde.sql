
-- Helper: pagamento está em fase do analista?
CREATE OR REPLACE FUNCTION public.is_payment_in_analyst_phase(p_payment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payments
    WHERE id = p_payment_id
      AND status IN ('rascunho','em_analise_ia','revisao_analista','concluida_analista','devolvido_analista')
  );
$$;

-- Reforça RLS do portal: empresa só interage durante fase do analista
DROP POLICY IF EXISTS "pval_empresa_update" ON public.production_validations;
CREATE POLICY "pval_empresa_update" ON public.production_validations
FOR UPDATE
USING (
  public.is_payment_in_analyst_phase(payment_id)
  AND company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  )
)
WITH CHECK (
  public.is_payment_in_analyst_phase(payment_id)
  AND company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  )
);

DROP POLICY IF EXISTS "pvf_empresa_insert" ON public.production_validation_feedbacks;
CREATE POLICY "pvf_empresa_insert" ON public.production_validation_feedbacks
FOR INSERT
WITH CHECK (
  validation_id IN (
    SELECT pv.id FROM public.production_validations pv
    JOIN public.company_portal_users cpu ON cpu.company_id = pv.company_id
    WHERE cpu.user_id = auth.uid()
      AND cpu.active = true
      AND public.is_payment_in_analyst_phase(pv.payment_id)
  )
);

-- Trigger: ao sair da fase do analista, expira validações ainda aguardando
CREATE OR REPLACE FUNCTION public.expire_validations_on_phase_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_analyst CONSTANT text[] := ARRAY['rascunho','em_analise_ia','revisao_analista','concluida_analista','devolvido_analista'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status = ANY(v_analyst)
     AND NOT (NEW.status = ANY(v_analyst))
  THEN
    UPDATE public.production_validations
       SET status = 'expirado',
           expires_at = LEAST(COALESCE(expires_at, now()), now())
     WHERE payment_id = NEW.id
       AND status = 'aguardando';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expire_validations_on_phase_advance ON public.payments;
CREATE TRIGGER trg_expire_validations_on_phase_advance
AFTER UPDATE OF status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.expire_validations_on_phase_advance();

-- Aplica retroativamente para pagamentos que já avançaram com validações ainda em aberto
UPDATE public.production_validations pv
   SET status = 'expirado'
  FROM public.payments p
 WHERE pv.payment_id = p.id
   AND pv.status = 'aguardando'
   AND p.status NOT IN ('rascunho','em_analise_ia','revisao_analista','concluida_analista','devolvido_analista');
