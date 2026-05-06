
-- Histórico de assumiu/transferiu por lote
CREATE TABLE public.payment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  analyst_id uuid NOT NULL,
  previous_analyst_id uuid,
  action text NOT NULL CHECK (action IN ('assumiu','transferiu')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  note text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_assignments_payment ON public.payment_assignments(payment_id, created_at DESC);

ALTER TABLE public.payment_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pa_view_workflow" ON public.payment_assignments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role) OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "pa_insert_workflow" ON public.payment_assignments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role) OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role)));
