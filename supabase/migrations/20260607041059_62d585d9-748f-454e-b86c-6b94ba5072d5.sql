-- Guard: confecção não pode pular direto para validação/aprovação.
-- Saídas permitidas a partir de em_confeccao: em_analise_ia, revisao_analista, cancelado, arquivado.
CREATE OR REPLACE FUNCTION public.block_confeccao_skip_to_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'em_confeccao'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('aguardando_validacao','aguardando_aprovacao',
                        'aprovado','aprovado_em_revisao','revisao_pos_aprovacao',
                        'pedido_nf_enviado','nf_recebida','nf_conciliada',
                        'lancado','pago') THEN
    RAISE EXCEPTION
      'Transição inválida: lote em CONFECÇÃO não pode ir direto para %.
       Encerre a confecção encaminhando para análise (em_analise_ia) antes.',
      NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_confeccao_skip_payments ON public.payments;
CREATE TRIGGER trg_block_confeccao_skip_payments
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.block_confeccao_skip_to_validation();

DROP TRIGGER IF EXISTS trg_block_confeccao_skip_groups ON public.payment_company_groups;
CREATE TRIGGER trg_block_confeccao_skip_groups
  BEFORE UPDATE OF status ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.block_confeccao_skip_to_validation();