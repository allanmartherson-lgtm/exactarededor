-- Tabela de sub-lote por empresa
CREATE TABLE public.payment_company_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  company_id uuid,
  company_name text NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'em_analise_ia',
  items_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  validated_by uuid,
  validated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcg_payment ON public.payment_company_groups(payment_id);
CREATE INDEX idx_pcg_status ON public.payment_company_groups(status);
CREATE UNIQUE INDEX uq_pcg_payment_company_name ON public.payment_company_groups(payment_id, lower(company_name));

ALTER TABLE public.payment_company_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcg_view_authenticated" ON public.payment_company_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "pcg_manage_workflow" ON public.payment_company_groups
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER pcg_touch_updated_at
  BEFORE UPDATE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Função: consolidar status do lote a partir dos grupos
CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_groups integer;
  s_aprovado integer;
  s_rejeitado integer;
  s_cancelado integer;
  s_em_analise integer;
  s_revisao integer;
  s_dev_analista integer;
  s_dev_validador integer;
  s_aguard_val integer;
  s_aguard_apr integer;
  new_status public.payment_status;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'aprovado'),
    count(*) FILTER (WHERE status = 'rejeitado'),
    count(*) FILTER (WHERE status = 'cancelado'),
    count(*) FILTER (WHERE status = 'em_analise_ia'),
    count(*) FILTER (WHERE status = 'revisao_analista'),
    count(*) FILTER (WHERE status = 'devolvido_analista'),
    count(*) FILTER (WHERE status = 'devolvido_validador'),
    count(*) FILTER (WHERE status = 'aguardando_validacao'),
    count(*) FILTER (WHERE status = 'aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_dev_validador, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups
  WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN
    RETURN;
  END IF;

  IF s_em_analise > 0 THEN
    new_status := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN
    new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN
    new_status := 'devolvido_analista';
  ELSIF s_dev_validador > 0 THEN
    new_status := 'devolvido_validador';
  ELSIF s_aguard_val > 0 THEN
    new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN
    new_status := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN
      new_status := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN
      new_status := 'rejeitado';
    ELSE
      new_status := 'cancelado';
    END IF;
  ELSE
    new_status := 'aguardando_validacao';
  END IF;

  UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_payment_status_from_groups(COALESCE(NEW.payment_id, OLD.payment_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER pcg_recompute_after_change
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_payment_status();

-- Backfill: lotes existentes ganham seus grupos com o status atual do lote
WITH src AS (
  SELECT
    pi.payment_id,
    pi.company_id,
    COALESCE(NULLIF(pi.company_name, ''), 'Sem empresa') AS company_name,
    count(*) AS items_count,
    sum(pi.gross_amount) AS total_amount
  FROM public.payment_items pi
  GROUP BY pi.payment_id, pi.company_id, COALESCE(NULLIF(pi.company_name, ''), 'Sem empresa')
)
INSERT INTO public.payment_company_groups
  (payment_id, company_id, company_name, status, items_count, total_amount)
SELECT src.payment_id, src.company_id, src.company_name, p.status, src.items_count, src.total_amount
FROM src
JOIN public.payments p ON p.id = src.payment_id
ON CONFLICT (payment_id, lower(company_name)) DO NOTHING;