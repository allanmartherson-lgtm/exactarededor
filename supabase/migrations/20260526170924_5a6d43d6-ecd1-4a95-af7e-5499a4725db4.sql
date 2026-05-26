
-- Staging para importação de médicos (será populada via INSERTs e consumida por função de merge)
CREATE TABLE IF NOT EXISTS public.doctors_import_staging (
  id bigserial PRIMARY KEY,
  full_name text NOT NULL,
  crm text NOT NULL,
  crm_uf text NOT NULL,
  cpf text,
  email text,
  phone text,
  birth_date date,
  specialties text,
  vinculo text,
  active boolean NOT NULL DEFAULT true,
  notes_pj text,
  notes_cnpj text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctors_import_staging TO authenticated;
GRANT ALL ON public.doctors_import_staging TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.doctors_import_staging_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.doctors_import_staging_id_seq TO service_role;

ALTER TABLE public.doctors_import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging_admin_all" ON public.doctors_import_staging
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- Função de merge: aplica staging -> doctors (upsert por crm+uf), retorna contagens.
CREATE OR REPLACE FUNCTION public.merge_doctors_from_staging()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_inserted int := 0;
  v_total_staging int;
BEGIN
  SELECT COUNT(*) INTO v_total_staging FROM public.doctors_import_staging;

  -- Atualiza existentes (match por crm+crm_uf normalizados)
  WITH upd AS (
    UPDATE public.doctors d SET
      full_name   = COALESCE(NULLIF(s.full_name,''), d.full_name),
      cpf         = COALESCE(NULLIF(s.cpf,''), d.cpf),
      email       = COALESCE(NULLIF(s.email,''), d.email),
      phone       = COALESCE(NULLIF(s.phone,''), d.phone),
      birth_date  = COALESCE(s.birth_date, d.birth_date),
      specialties = CASE
        WHEN NULLIF(s.specialties,'') IS NULL THEN d.specialties
        ELSE ARRAY(SELECT DISTINCT trim(x) FROM unnest(string_to_array(s.specialties, ',')) x WHERE trim(x) <> '')
      END,
      vinculo     = COALESCE(NULLIF(s.vinculo,''), d.vinculo),
      active      = s.active,
      notes       = CASE
        WHEN NULLIF(s.notes_pj,'') IS NULL AND NULLIF(s.notes_cnpj,'') IS NULL THEN d.notes
        ELSE concat_ws(' | ', NULLIF(s.notes_pj,''), CASE WHEN NULLIF(s.notes_cnpj,'') IS NOT NULL THEN 'CNPJ: '||s.notes_cnpj END)
      END,
      updated_at = now()
    FROM public.doctors_import_staging s
    WHERE upper(trim(d.crm)) = upper(trim(s.crm))
      AND upper(trim(d.crm_uf)) = upper(trim(s.crm_uf))
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  -- Insere novos (que não existem em doctors)
  WITH ins AS (
    INSERT INTO public.doctors (full_name, crm, crm_uf, cpf, email, phone, birth_date, specialties, vinculo, active, notes)
    SELECT
      s.full_name, s.crm, s.crm_uf,
      NULLIF(s.cpf,''), NULLIF(s.email,''), NULLIF(s.phone,''), s.birth_date,
      CASE WHEN NULLIF(s.specialties,'') IS NULL THEN ARRAY[]::text[]
           ELSE ARRAY(SELECT DISTINCT trim(x) FROM unnest(string_to_array(s.specialties, ',')) x WHERE trim(x) <> '')
      END,
      NULLIF(s.vinculo,''), s.active,
      NULLIF(concat_ws(' | ', NULLIF(s.notes_pj,''), CASE WHEN NULLIF(s.notes_cnpj,'') IS NOT NULL THEN 'CNPJ: '||s.notes_cnpj END), '')
    FROM public.doctors_import_staging s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE upper(trim(d.crm)) = upper(trim(s.crm))
        AND upper(trim(d.crm_uf)) = upper(trim(s.crm_uf))
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  -- Limpa staging
  TRUNCATE public.doctors_import_staging;

  RETURN jsonb_build_object(
    'staging_rows', v_total_staging,
    'updated', v_updated,
    'inserted', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_doctors_from_staging() TO authenticated;
