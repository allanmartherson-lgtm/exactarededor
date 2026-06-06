
CREATE TABLE public.thread_view_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.company_threads(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL,
  viewer_role text NOT NULL,
  unread_before integer,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_thread_view_log_thread ON public.thread_view_log(thread_id, viewed_at DESC);
CREATE INDEX idx_thread_view_log_viewer ON public.thread_view_log(viewer_user_id, viewed_at DESC);

GRANT SELECT, INSERT ON public.thread_view_log TO authenticated;
GRANT ALL ON public.thread_view_log TO service_role;

ALTER TABLE public.thread_view_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internos veem histórico de visualizações de conversas"
ON public.thread_view_log FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'analista'::app_role)
  OR public.has_role(auth.uid(), 'validador'::app_role)
  OR public.has_role(auth.uid(), 'diretor'::app_role)
);

CREATE POLICY "Usuário registra a própria visualização"
ON public.thread_view_log FOR INSERT
TO authenticated
WITH CHECK (viewer_user_id = auth.uid());
