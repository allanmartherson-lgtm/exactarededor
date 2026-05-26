-- 1. Adicionar 'cancelada' ao enum invoice_status
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelada';

-- 2. Função que cancela invoices quando o grupo regride de status
CREATE OR REPLACE FUNCTION public.trg_cancel_invoices_on_regression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text IN ('revisao_analista','devolvido_analista','concluida_analista',
                          'aguardando_validacao','aguardando_aprovacao','revisao_pos_aprovacao')
     AND OLD.status::text IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente')
  THEN
    UPDATE public.invoices
       SET status = 'cancelada'::invoice_status,
           updated_at = now()
     WHERE payment_id = NEW.payment_id
       AND company_id = NEW.company_id
       AND status::text IN ('aguardando','recebida');
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Trigger AFTER UPDATE OF status em payment_company_groups
DROP TRIGGER IF EXISTS trg_cancel_invoices_on_regression ON public.payment_company_groups;
CREATE TRIGGER trg_cancel_invoices_on_regression
  AFTER UPDATE OF status ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_cancel_invoices_on_regression();