-- ============================================================
-- 1) Pendências (tickets da empresa para o analista)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pendencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by_user_id  uuid REFERENCES auth.users(id),
  created_by_name     text NOT NULL,

  patient_name        text NOT NULL CHECK (length(patient_name) BETWEEN 2 AND 200),
  event_date          date NOT NULL,
  event_type          text NOT NULL CHECK (event_type IN ('cirurgia','parecer','atendimento','outro')),
  attendance_number   text,
  agreement_name      text NOT NULL CHECK (length(agreement_name) BETWEEN 1 AND 120),
  doctor_name         text NOT NULL CHECK (length(doctor_name) BETWEEN 2 AND 200),

  subject             text NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  description         text NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),

  status              text NOT NULL DEFAULT 'aberta'
                      CHECK (status IN ('aberta','em_analise','respondida','resolvida','cancelada')),
  priority            text NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('baixa','normal','alta')),
  assigned_to         uuid REFERENCES auth.users(id),
  payment_id          uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  thread_id           uuid REFERENCES public.company_threads(id) ON DELETE SET NULL,

  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pend_company   ON public.pendencias(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pend_status    ON public.pendencias(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pend_assignee  ON public.pendencias(assigned_to);

GRANT SELECT, INSERT, UPDATE ON public.pendencias TO authenticated;
GRANT ALL ON public.pendencias TO service_role;

ALTER TABLE public.pendencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pend_company_select" ON public.pendencias;
CREATE POLICY "pend_company_select" ON public.pendencias
  FOR SELECT TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

DROP POLICY IF EXISTS "pend_company_insert" ON public.pendencias;
CREATE POLICY "pend_company_insert" ON public.pendencias
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

DROP POLICY IF EXISTS "pend_company_update" ON public.pendencias;
CREATE POLICY "pend_company_update" ON public.pendencias
  FOR UPDATE TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

DROP POLICY IF EXISTS "pend_internal_all" ON public.pendencias;
CREATE POLICY "pend_internal_all" ON public.pendencias
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_pendencias_updated_at ON public.pendencias;
CREATE TRIGGER trg_pendencias_updated_at
BEFORE UPDATE ON public.pendencias
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2) Anexos do Portal Parceiro
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-attachments', 'company-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.company_messages(id) ON DELETE CASCADE,
  pendencia_id uuid REFERENCES public.pendencias(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('empresa','analista','sistema')) DEFAULT 'empresa',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_attachment_target CHECK (
    (message_id IS NOT NULL)::int + (pendencia_id IS NOT NULL)::int >= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_company_attachments_message   ON public.company_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_company_attachments_pendencia ON public.company_attachments(pendencia_id);
CREATE INDEX IF NOT EXISTS idx_company_attachments_company   ON public.company_attachments(company_id);

GRANT SELECT, INSERT ON public.company_attachments TO authenticated;
GRANT ALL ON public.company_attachments TO service_role;

ALTER TABLE public.company_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_belongs_to_company(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_portal_users
    WHERE company_id = _company_id AND user_id = auth.uid() AND active = true
  );
$$;

DROP POLICY IF EXISTS ca_select_own_company ON public.company_attachments;
CREATE POLICY ca_select_own_company ON public.company_attachments
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_company(company_id));

DROP POLICY IF EXISTS ca_insert_own_company ON public.company_attachments;
CREATE POLICY ca_insert_own_company ON public.company_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_belongs_to_company(company_id)
    AND uploaded_by_user_id = auth.uid()
    AND uploaded_by_type = 'empresa'
  );

DROP POLICY IF EXISTS company_attachments_select ON storage.objects;
CREATE POLICY company_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-attachments'
    AND public.user_belongs_to_company( (storage.foldername(name))[1]::uuid )
  );

DROP POLICY IF EXISTS company_attachments_insert ON storage.objects;
CREATE POLICY company_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-attachments'
    AND public.user_belongs_to_company( (storage.foldername(name))[1]::uuid )
  );