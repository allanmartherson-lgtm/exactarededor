
-- Índice para lookup por CPF (já normalizado em dígitos pela Fase 2)
CREATE INDEX IF NOT EXISTS idx_doctors_cpf ON public.doctors(cpf) WHERE cpf IS NOT NULL;

-- Função de lookup unificado para login do app do médico
-- Aceita: "12345678901" (CPF), "123.456.789-01" (CPF formatado) ou "16412/DF" (CRM/UF)
CREATE OR REPLACE FUNCTION public.find_doctor_for_login(identifier text)
RETURNS TABLE (
  doctor_id uuid,
  full_name text,
  crm text,
  crm_uf text,
  cpf text,
  email text,
  active boolean,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
  crm_part text;
  uf_part text;
BEGIN
  IF identifier IS NULL OR length(trim(identifier)) = 0 THEN
    RETURN;
  END IF;

  digits := regexp_replace(identifier, '\D', '', 'g');

  -- CPF: exatamente 11 dígitos
  IF length(digits) = 11 THEN
    RETURN QUERY
    SELECT d.id, d.full_name, d.crm, d.crm_uf, d.cpf, d.email, d.active, 'cpf'::text
    FROM doctors d
    WHERE d.cpf = digits
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- CRM/UF
  IF position('/' in identifier) > 0 THEN
    crm_part := trim(split_part(identifier, '/', 1));
    uf_part := upper(trim(split_part(identifier, '/', 2)));
    RETURN QUERY
    SELECT d.id, d.full_name, d.crm, d.crm_uf, d.cpf, d.email, d.active, 'crm_uf'::text
    FROM doctors d
    WHERE d.crm = crm_part AND d.crm_uf = uf_part
    LIMIT 1;
  END IF;
END;
$$;

-- Permitir uso pelo app (autenticado e anônimo durante fluxo de invite/login)
GRANT EXECUTE ON FUNCTION public.find_doctor_for_login(text) TO anon, authenticated;
