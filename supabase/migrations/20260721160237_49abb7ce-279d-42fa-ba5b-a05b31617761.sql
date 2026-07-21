-- 1. Restringir acesso direto às colunas PII em doctors
REVOKE SELECT (cpf, birth_date, phone, email) ON public.doctors FROM authenticated;
REVOKE SELECT (cpf, birth_date, phone, email) ON public.doctors FROM anon;

-- 2. RPC para admin/diretor buscar PII quando necessário (edição, revisão)
CREATE OR REPLACE FUNCTION public.get_doctors_pii(doctor_ids uuid[])
RETURNS TABLE(id uuid, cpf text, birth_date date, phone text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: dados sensíveis do médico exigem papel admin ou diretor';
  END IF;
  RETURN QUERY
    SELECT d.id, d.cpf, d.birth_date, d.phone, d.email
      FROM public.doctors d
     WHERE d.id = ANY(doctor_ids);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_doctors_pii(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_doctors_pii(uuid[]) TO authenticated;

-- 3. Lookup por documento sem devolver PII bruta (permite matching na ingestão)
CREATE OR REPLACE FUNCTION public.find_doctor_by_document(doc text)
RETURNS TABLE(id uuid, full_name text, crm text, crm_uf text, specialties text[])
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT d.id, d.full_name, d.crm, d.crm_uf, d.specialties
    FROM public.doctors d
   WHERE d.cpf IS NOT NULL
     AND regexp_replace(coalesce(d.cpf, ''), '\D', '', 'g') =
         regexp_replace(coalesce(doc,   ''), '\D', '', 'g')
     AND d.active = true
   LIMIT 5;
$fn$;
REVOKE ALL ON FUNCTION public.find_doctor_by_document(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_doctor_by_document(text) TO authenticated;

-- 4. doctors_import_staging: adiciona created_at e purga automática após 7 dias
ALTER TABLE public.doctors_import_staging
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_doctors_import_staging_created_at
  ON public.doctors_import_staging(created_at);

CREATE OR REPLACE FUNCTION public.purge_stale_doctors_import_staging()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM public.doctors_import_staging
   WHERE created_at < now() - interval '7 days';
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_purge_doctors_import_staging ON public.doctors_import_staging;
CREATE TRIGGER trg_purge_doctors_import_staging
  AFTER INSERT ON public.doctors_import_staging
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.purge_stale_doctors_import_staging();