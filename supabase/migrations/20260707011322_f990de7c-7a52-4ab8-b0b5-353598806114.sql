
-- Helper predicate: internal staff roles (matches existing pattern used across suggestion tables)
-- We inline the check rather than adding a new function to minimize surface area.

-- 1) access_requests: authenticated insert must mirror anon constraints (no elevated roles/hospital)
DROP POLICY IF EXISTS "ar_insert_authenticated" ON public.access_requests;
CREATE POLICY "ar_insert_authenticated"
ON public.access_requests
FOR INSERT
TO authenticated
WITH CHECK (
  status = 'pendente'
  AND hospital_id IS NULL
  AND requested_roles = ARRAY['analista'::text]
);

-- 2) payment_parecer_report_rows: restrict inserts to internal staff + scoped report
DROP POLICY IF EXISTS "auth insert parecer rows" ON public.payment_parecer_report_rows;
CREATE POLICY "staff insert parecer rows"
ON public.payment_parecer_report_rows
FOR INSERT
TO authenticated
WITH CHECK (
  (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.payment_parecer_reports r
    WHERE r.id = payment_parecer_report_rows.report_id
      AND (r.hospital_id IS NULL OR hospital_scope_allows(r.hospital_id))
  )
);

-- 3) payment_parecer_reports: restrict insert/update to internal staff + hospital scope
DROP POLICY IF EXISTS "auth insert parecer reports" ON public.payment_parecer_reports;
CREATE POLICY "staff insert parecer reports"
ON public.payment_parecer_reports
FOR INSERT
TO authenticated
WITH CHECK (
  (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND (hospital_id IS NULL OR hospital_scope_allows(hospital_id))
);

DROP POLICY IF EXISTS "auth update parecer reports" ON public.payment_parecer_reports;
CREATE POLICY "staff update parecer reports"
ON public.payment_parecer_reports
FOR UPDATE
TO authenticated
USING (
  (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND (hospital_id IS NULL OR hospital_scope_allows(hospital_id))
)
WITH CHECK (
  (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND (hospital_id IS NULL OR hospital_scope_allows(hospital_id))
);

-- 4) company_link_suggestions: restrict insert to staff
DROP POLICY IF EXISTS "insert_company_link_suggestions" ON public.company_link_suggestions;
CREATE POLICY "insert_company_link_suggestions"
ON public.company_link_suggestions
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);

-- 5) convenio_link_suggestions: restrict insert to staff
DROP POLICY IF EXISTS "insert_convenio_link_suggestions" ON public.convenio_link_suggestions;
CREATE POLICY "insert_convenio_link_suggestions"
ON public.convenio_link_suggestions
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);

-- 6) sector_link_suggestions: restrict insert to staff
DROP POLICY IF EXISTS "insert_sector_link_suggestions" ON public.sector_link_suggestions;
CREATE POLICY "insert_sector_link_suggestions"
ON public.sector_link_suggestions
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);

-- 7) match_telemetry: restrict insert to staff
DROP POLICY IF EXISTS "insert_match_telemetry" ON public.match_telemetry;
CREATE POLICY "insert_match_telemetry"
ON public.match_telemetry
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);

-- 8) specialty_audit_log: restrict SELECT to staff (was qual:true)
DROP POLICY IF EXISTS "Authenticated can read specialty audit log" ON public.specialty_audit_log;
CREATE POLICY "Staff can read specialty audit log"
ON public.specialty_audit_log
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);
