-- Corrige RLS bloqueando reclassificação de itens (parecer → visita e afins).
-- O trigger fix_numeric_procedure_name insere aprendizados em
-- tuss_procedure_names, mas rodava com o papel do analista, que não tem
-- INSERT nessa tabela (só admin). Passa para SECURITY DEFINER — o aprendizado
-- é global e determinístico (ON CONFLICT DO NOTHING), sem risco de escalada.

CREATE OR REPLACE FUNCTION public.fix_numeric_procedure_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clean_code text;
  v_canonical text;
BEGIN
  IF NEW.procedure_name IS NOT NULL AND NEW.procedure_name ~ '^\d' THEN
    v_clean_code := regexp_replace(coalesce(NEW.procedure_code, ''), '\D', '', 'g');
    IF v_clean_code != '' THEN
      SELECT canonical_name INTO v_canonical
      FROM public.tuss_procedure_names
      WHERE code = v_clean_code;
      IF v_canonical IS NOT NULL THEN
        NEW.procedure_name := v_canonical;
      END IF;
    END IF;
  END IF;

  IF NEW.procedure_name IS NOT NULL
     AND NEW.procedure_name !~ '^\d'
     AND NEW.procedure_code IS NOT NULL THEN
    v_clean_code := regexp_replace(NEW.procedure_code, '\D', '', 'g');
    IF v_clean_code != '' THEN
      INSERT INTO public.tuss_procedure_names (code, canonical_name, source)
      VALUES (v_clean_code, NEW.procedure_name, 'auto-learn')
      ON CONFLICT (code) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Blindagem: só o dono/serviço executa (mesmo padrão dos outros SECURITY DEFINER do projeto).
REVOKE ALL ON FUNCTION public.fix_numeric_procedure_name() FROM PUBLIC;