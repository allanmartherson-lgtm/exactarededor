-- 1) Diretores autorizados por hospital
CREATE TABLE public.hospital_directors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_hospital_directors_email ON public.hospital_directors(hospital_id, lower(email));
CREATE INDEX idx_hospital_directors_hospital ON public.hospital_directors(hospital_id) WHERE active;
CREATE INDEX idx_hospital_directors_email ON public.hospital_directors(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_directors TO authenticated;
GRANT ALL ON public.hospital_directors TO service_role;

ALTER TABLE public.hospital_directors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital members can view directors"
ON public.hospital_directors FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid() AND uh.hospital_id = hospital_directors.hospital_id
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins and directors manage directors"
ON public.hospital_directors FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

CREATE TRIGGER update_hospital_directors_updated_at
BEFORE UPDATE ON public.hospital_directors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Aprovações por e-mail anexadas a pagamentos
CREATE TYPE public.email_approval_status AS ENUM (
  'pending_parse', 'parsing', 'validated', 'divergent', 'parse_failed', 'applied', 'rejected'
);

CREATE TABLE public.payment_email_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_mime TEXT NOT NULL,
  file_size_bytes BIGINT,
  status public.email_approval_status NOT NULL DEFAULT 'pending_parse',
  extracted JSONB,
  matched_director_id UUID REFERENCES public.hospital_directors(id) ON DELETE SET NULL,
  validation_errors TEXT[] NOT NULL DEFAULT '{}',
  ai_model TEXT,
  parse_attempts INT NOT NULL DEFAULT 0,
  parsed_at TIMESTAMPTZ,
  uploaded_by UUID NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by UUID,
  applied_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pea_payment ON public.payment_email_approvals(payment_id);
CREATE INDEX idx_pea_status ON public.payment_email_approvals(status);
CREATE INDEX idx_pea_hospital ON public.payment_email_approvals(hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_email_approvals TO authenticated;
GRANT ALL ON public.payment_email_approvals TO service_role;

ALTER TABLE public.payment_email_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital members can view email approvals"
ON public.payment_email_approvals FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_email_approvals.hospital_id
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Hospital members can attach email approvals"
ON public.payment_email_approvals FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_email_approvals.hospital_id
    )
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "Hospital members can update email approvals"
ON public.payment_email_approvals FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_email_approvals.hospital_id
  )
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_email_approvals.hospital_id
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins delete email approvals"
ON public.payment_email_approvals FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_payment_email_approvals_updated_at
BEFORE UPDATE ON public.payment_email_approvals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Policies de Storage para o bucket payment-email-approvals
CREATE POLICY "Hospital members can read email approval files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-email-approvals'
  AND EXISTS (
    SELECT 1
    FROM public.payment_email_approvals pea
    JOIN public.user_hospitals uh
      ON uh.hospital_id = pea.hospital_id AND uh.user_id = auth.uid()
    WHERE pea.file_path = storage.objects.name
  )
);

CREATE POLICY "Hospital members can upload email approval files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-email-approvals'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Admins delete email approval files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'payment-email-approvals'
  AND public.has_role(auth.uid(), 'admin')
);