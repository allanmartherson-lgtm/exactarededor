DO $$ BEGIN
  CREATE TYPE public.payment_type AS ENUM ('producao','repasse','valor_fixo','plantao','misto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_kind AS ENUM ('atual','pendencia','misto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS competence_month date,
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS payment_type public.payment_type,
  ADD COLUMN IF NOT EXISTS payment_kind public.payment_kind;

DROP POLICY IF EXISTS "payments_delete_workflow" ON public.payments;
CREATE POLICY "payments_delete_workflow"
ON public.payments
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR (
    auth.uid() = created_by
    AND status IN ('rascunho','em_analise_ia','aguardando_validacao','devolvido_analista','cancelado')
  )
);

DROP POLICY IF EXISTS "items_delete_workflow" ON public.payment_items;
CREATE POLICY "items_delete_workflow"
ON public.payment_items
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_items.payment_id
      AND p.created_by = auth.uid()
      AND p.status IN ('rascunho','em_analise_ia','aguardando_validacao','devolvido_analista','cancelado')
  )
);
