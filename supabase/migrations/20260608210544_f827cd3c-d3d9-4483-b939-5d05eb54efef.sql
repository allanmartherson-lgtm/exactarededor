
CREATE TABLE public.export_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  user_name text,
  report_key text NOT NULL,
  report_label text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','pdf','print','view')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  hospital_id uuid,
  row_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_export_log_created_at ON public.export_log (created_at DESC);
CREATE INDEX idx_export_log_user ON public.export_log (user_id);
CREATE INDEX idx_export_log_report ON public.export_log (report_key);

GRANT SELECT, INSERT ON public.export_log TO authenticated;
GRANT ALL ON public.export_log TO service_role;

ALTER TABLE public.export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own export entries"
  ON public.export_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own export entries"
  ON public.export_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admin/diretor/validador view all export entries"
  ON public.export_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'validador')
  );
