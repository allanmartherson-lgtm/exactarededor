
-- 1. Colunas
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bruto_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liquido_total numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS bruto_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liquido_total numeric(14,2) NOT NULL DEFAULT 0;

-- 2. Função de recompute (idempotente, segura)
CREATE OR REPLACE FUNCTION public.recompute_payment_liquido(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recalcula por grupo (empresa). Bruto = soma dos itens; Líquido = snapshot se existir, senão bruto.
  WITH brutos AS (
    SELECT
      pcg.id AS group_id,
      pcg.payment_id,
      pcg.company_id,
      COALESCE(SUM(pi.gross_amount), 0)::numeric(14,2) AS bruto
    FROM public.payment_company_groups pcg
    LEFT JOIN public.payment_items pi
      ON pi.payment_id = pcg.payment_id
     AND ((pcg.company_id IS NOT NULL AND pi.company_id = pcg.company_id)
          OR (pcg.company_id IS NULL AND lower(pi.company_name) = lower(pcg.company_name)))
    WHERE pcg.payment_id = _payment_id
    GROUP BY pcg.id, pcg.payment_id, pcg.company_id
  ),
  composto AS (
    SELECT
      b.group_id,
      b.bruto,
      COALESCE(pcf.liquido, b.bruto)::numeric(14,2) AS liquido
    FROM brutos b
    LEFT JOIN public.payment_company_financials pcf
      ON pcf.payment_id = b.payment_id AND pcf.company_id = b.company_id
  )
  UPDATE public.payment_company_groups pcg
     SET bruto_total = c.bruto,
         liquido_total = c.liquido,
         updated_at = now()
    FROM composto c
   WHERE pcg.id = c.group_id;

  -- Agrega no payment
  UPDATE public.payments p
     SET bruto_total = COALESCE(s.bruto, 0),
         liquido_total = COALESCE(s.liquido, 0),
         updated_at = now()
    FROM (
      SELECT
        payment_id,
        SUM(bruto_total)::numeric(14,2) AS bruto,
        SUM(liquido_total)::numeric(14,2) AS liquido
      FROM public.payment_company_groups
      WHERE payment_id = _payment_id
      GROUP BY payment_id
    ) s
   WHERE p.id = _payment_id AND p.id = s.payment_id;
END;
$$;

-- 3. Trigger em payment_company_financials → mantém líquido sincronizado
CREATE OR REPLACE FUNCTION public.trg_recompute_liquido_from_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_payment_liquido(COALESCE(NEW.payment_id, OLD.payment_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pcf_recompute_liquido ON public.payment_company_financials;
CREATE TRIGGER pcf_recompute_liquido
AFTER INSERT OR UPDATE OR DELETE ON public.payment_company_financials
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_liquido_from_financials();

-- 4. Trigger em payment_company_groups (recém-criados) → bootstrap bruto/líquido
CREATE OR REPLACE FUNCTION public.trg_recompute_liquido_from_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_payment_liquido(COALESCE(NEW.payment_id, OLD.payment_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pcg_recompute_liquido ON public.payment_company_groups;
CREATE TRIGGER pcg_recompute_liquido
AFTER INSERT ON public.payment_company_groups
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_liquido_from_group();

-- 5. Backfill — roda recompute para todos os pagamentos existentes
DO $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT id FROM public.payments LOOP
    PERFORM public.recompute_payment_liquido(pid);
  END LOOP;
END$$;

-- 6. Índice para leitura por líquido (dashboards, ranking)
CREATE INDEX IF NOT EXISTS idx_payments_liquido ON public.payments(liquido_total DESC);
