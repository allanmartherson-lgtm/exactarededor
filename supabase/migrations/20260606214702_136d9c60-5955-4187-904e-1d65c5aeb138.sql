
CREATE TABLE IF NOT EXISTS public.pendencia_routing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pendencia_id uuid NOT NULL,
  opened_by text NOT NULL,
  doctor_id uuid,
  attempted_thread_id uuid,
  action text NOT NULL,
  reason text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pendencia_routing_log TO authenticated;
GRANT ALL ON public.pendencia_routing_log TO service_role;

ALTER TABLE public.pendencia_routing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routing_log_internal_select" ON public.pendencia_routing_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'diretor')
  );

CREATE INDEX IF NOT EXISTS idx_pend_routing_log_pend
  ON public.pendencia_routing_log(pendencia_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_pendencia_thread_routing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.opened_by = 'medico' AND NEW.thread_id IS NOT NULL THEN
    INSERT INTO public.pendencia_routing_log(
      pendencia_id, opened_by, doctor_id, attempted_thread_id,
      action, reason, actor_id
    ) VALUES (
      NEW.id, NEW.opened_by, NEW.doctor_id, NEW.thread_id,
      'blocked_thread_assign',
      'Pendência aberta pelo médico não pode ser vinculada a company_threads; conversa deve viver em doctor_messages.',
      auth.uid()
    );
    NEW.thread_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_pendencia_thread_routing ON public.pendencias;
CREATE TRIGGER trg_guard_pendencia_thread_routing
  BEFORE INSERT OR UPDATE OF thread_id, opened_by ON public.pendencias
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_pendencia_thread_routing();

NOTIFY pgrst, 'reload schema';
