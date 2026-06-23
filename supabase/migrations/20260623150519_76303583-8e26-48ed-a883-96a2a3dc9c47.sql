
CREATE TYPE public.rule_suggestion_status AS ENUM ('pending', 'approved', 'rejected', 'converted');

CREATE TABLE public.rule_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  company_group_id UUID REFERENCES public.payment_company_groups(id) ON DELETE SET NULL,
  suggested_by UUID NOT NULL REFERENCES auth.users(id),
  status public.rule_suggestion_status NOT NULL DEFAULT 'pending',
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  doctor_name TEXT,
  procedure_code TEXT,
  procedure_description TEXT,
  sample_item_ids UUID[] NOT NULL DEFAULT '{}',
  occurrences INTEGER NOT NULL DEFAULT 0,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  justification TEXT NOT NULL,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_rule_id UUID REFERENCES public.rules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rule_suggestions_hospital_status ON public.rule_suggestions(hospital_id, status, created_at DESC);
CREATE INDEX idx_rule_suggestions_payment ON public.rule_suggestions(payment_id);
CREATE INDEX idx_rule_suggestions_suggested_by ON public.rule_suggestions(suggested_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rule_suggestions TO authenticated;
GRANT ALL ON public.rule_suggestions TO service_role;

ALTER TABLE public.rule_suggestions ENABLE ROW LEVEL SECURITY;

-- Visualização: qualquer usuário autenticado vinculado ao hospital (mesma regra de payments)
CREATE POLICY "Hospital users can view rule_suggestions"
  ON public.rule_suggestions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid()
        AND uh.hospital_id = rule_suggestions.hospital_id
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- Criação: qualquer usuário autenticado vinculado ao hospital, gravando o próprio id
CREATE POLICY "Hospital users can create rule_suggestions"
  ON public.rule_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (
    suggested_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.user_hospitals uh
        WHERE uh.user_id = auth.uid()
          AND uh.hospital_id = rule_suggestions.hospital_id
      )
      OR public.has_role(auth.uid(), 'admin')
    )
  );

-- Atualização: apenas diretor e admin
CREATE POLICY "Diretor/admin can update rule_suggestions"
  ON public.rule_suggestions FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'admin')
  );

-- Delete: só admin
CREATE POLICY "Admin can delete rule_suggestions"
  ON public.rule_suggestions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_rule_suggestions_updated_at
  BEFORE UPDATE ON public.rule_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
