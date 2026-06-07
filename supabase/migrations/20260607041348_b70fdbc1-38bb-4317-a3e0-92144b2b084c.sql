-- ============================================================
-- Cross-check NF (invoices) × pedido (payment_company_groups.bruto_total)
-- Tolerância: zero. Divergência → status 'divergente' + bloqueio.
-- ============================================================

-- 1) Trigger em invoices: ao gravar received_amount, compara com bruto_total do grupo.
CREATE OR REPLACE FUNCTION public.enforce_invoice_amount_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pedido_bruto numeric;
  diff numeric;
BEGIN
  -- Só checa quando há valor recebido e referência de grupo.
  IF NEW.received_amount IS NULL OR NEW.company_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só faz sentido validar quando a NF já foi recebida (não em rascunho).
  IF NEW.status NOT IN ('recebida','conciliada','divergente') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(bruto_total, total_amount, 0)
    INTO pedido_bruto
  FROM public.payment_company_groups
  WHERE id = NEW.company_group_id;

  IF pedido_bruto IS NULL OR pedido_bruto = 0 THEN
    -- Sem referência do pedido — não trava (não há contra o que cruzar).
    RETURN NEW;
  END IF;

  diff := ROUND(NEW.received_amount::numeric, 2) - ROUND(pedido_bruto::numeric, 2);

  IF diff <> 0 THEN
    -- Força status divergente, registra motivo. Bloqueia conciliação.
    NEW.status := 'divergente';
    NEW.reconciliation_notes := COALESCE(NEW.reconciliation_notes, '') ||
      CASE WHEN COALESCE(NEW.reconciliation_notes,'') = '' THEN '' ELSE E'\n' END ||
      format('[auto] NF R$ %s × pedido R$ %s — diferença R$ %s (tolerância zero).',
             to_char(NEW.received_amount, 'FM999G999G990D00'),
             to_char(pedido_bruto,        'FM999G999G990D00'),
             to_char(diff,                'FM999G999G990D00'));
  ELSIF NEW.status = 'divergente' THEN
    -- Valores agora batem: libera para 'recebida' (analista decide conciliar).
    NEW.status := 'recebida';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_amount_match ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_amount_match
  BEFORE INSERT OR UPDATE OF received_amount, status, company_group_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_amount_match();

-- 2) Bloqueio: grupo não avança para nf_conciliada/lancado/pago enquanto NF divergente existir.
CREATE OR REPLACE FUNCTION public.block_group_advance_on_invoice_divergence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_divergente boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('nf_conciliada','lancado','pago') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE company_group_id = NEW.id
      AND status = 'divergente'
  ) INTO has_divergente;

  IF has_divergente THEN
    RAISE EXCEPTION
      'Transição bloqueada: existe NF divergente vinculada a este grupo (valor da NF não bate com o pedido). Resolva a divergência antes de avançar para %.',
      NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_group_advance_on_invoice_divergence ON public.payment_company_groups;
CREATE TRIGGER trg_block_group_advance_on_invoice_divergence
  BEFORE UPDATE OF status ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.block_group_advance_on_invoice_divergence();