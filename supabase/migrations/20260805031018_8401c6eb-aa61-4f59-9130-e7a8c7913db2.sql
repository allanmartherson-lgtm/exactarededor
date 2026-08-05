CREATE TABLE public.agreement_registration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreement_registrations(id) ON DELETE CASCADE,
  hospital_id uuid REFERENCES public.hospitals(id),
  cycle integer NOT NULL DEFAULT 1,
  event_type text NOT NULL CHECK (event_type IN ('rejeicao_diretor','reenvio_contratos')),
  actor_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agreement_events_agreement ON public.agreement_registration_events(agreement_id, created_at);

GRANT SELECT ON public.agreement_registration_events TO authenticated;
GRANT ALL ON public.agreement_registration_events TO service_role;

ALTER TABLE public.agreement_registration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select_scoped" ON public.agreement_registration_events
FOR SELECT TO authenticated
USING (public.can_access_agreement(agreement_id));

CREATE OR REPLACE FUNCTION public.resubmit_agreement_after_rejection(p_agreement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreement public.agreement_registrations%ROWTYPE;
  v_cycle integer;
BEGIN
  SELECT * INTO v_agreement FROM public.agreement_registrations WHERE id = p_agreement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acordo não encontrado';
  END IF;

  IF NOT public.can_access_agreement(p_agreement_id) THEN
    RAISE EXCEPTION 'Sem acesso a este acordo';
  END IF;

  -- Só o preenchedor original (Contratos) ou papéis administrativos podem reabrir
  IF NOT (
    v_agreement.filled_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'gestao_medica')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reenviar este acordo';
  END IF;

  IF v_agreement.status <> 'rejeitado' THEN
    RAISE EXCEPTION 'Somente acordos rejeitados podem ser corrigidos e reenviados';
  END IF;

  SELECT COALESCE(MAX(cycle), 0) + 1 INTO v_cycle
  FROM public.agreement_registration_events
  WHERE agreement_id = p_agreement_id;

  -- Histórico: registra as rejeições do ciclo atual ANTES de limpar os campos
  INSERT INTO public.agreement_registration_events
    (agreement_id, hospital_id, cycle, event_type, actor_id, notes, created_at)
  SELECT p_agreement_id, h.hospital_id, v_cycle, 'rejeicao_diretor', h.director_id,
         COALESCE(h.rejection_reason, h.director_notes),
         COALESCE(h.director_approved_at, now())
  FROM public.agreement_registration_hospitals h
  WHERE h.agreement_id = p_agreement_id AND h.status = 'rejeitado';

  INSERT INTO public.agreement_registration_events
    (agreement_id, hospital_id, cycle, event_type, actor_id, notes)
  VALUES (p_agreement_id, NULL, v_cycle, 'reenvio_contratos', auth.uid(),
          'Acordo corrigido e reenviado para novo ciclo de aprovação');

  UPDATE public.agreement_registration_hospitals
  SET status = 'aguardando_diretor',
      director_id = NULL,
      director_approved_at = NULL,
      director_notes = NULL,
      rejection_reason = NULL
  WHERE agreement_id = p_agreement_id;

  UPDATE public.agreement_registrations
  SET status = 'aguardando_supervisor',
      supervisor_id = NULL,
      supervisor_validated_at = NULL,
      supervisor_notes = NULL,
      rejection_reason = NULL,
      updated_at = now()
  WHERE id = p_agreement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resubmit_agreement_after_rejection(uuid) TO authenticated;