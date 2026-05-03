-- Histórico de mudanças de status para cálculo de tempos por etapa
CREATE TABLE IF NOT EXISTS public.payment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  status_from public.payment_status,
  status_to public.payment_status NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

CREATE INDEX IF NOT EXISTS idx_psh_payment ON public.payment_status_history(payment_id, changed_at DESC);

ALTER TABLE public.payment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psh_view_workflow" ON public.payment_status_history
FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role) OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "psh_insert_workflow" ON public.payment_status_history
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role) OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

-- Trigger: registra quando status muda (ou quando é criado)
CREATE OR REPLACE FUNCTION public.trg_log_payment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.payment_status_history(payment_id, status_from, status_to, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.payment_status_history(payment_id, status_from, status_to, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_status_history_trg ON public.payments;
CREATE TRIGGER payments_status_history_trg
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_log_payment_status_change();

-- Backfill: cria entrada inicial para pagamentos existentes
INSERT INTO public.payment_status_history (payment_id, status_from, status_to, changed_at, changed_by)
SELECT p.id, NULL, p.status, COALESCE(p.updated_at, p.created_at), p.created_by
FROM public.payments p
WHERE NOT EXISTS (SELECT 1 FROM public.payment_status_history h WHERE h.payment_id = p.id);
