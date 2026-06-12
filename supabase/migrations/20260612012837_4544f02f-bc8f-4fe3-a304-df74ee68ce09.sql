-- 1. Coluna opcional de sigla customizada
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS code_prefix text;
ALTER TABLE public.hospitals ADD CONSTRAINT hospitals_code_prefix_format
  CHECK (code_prefix IS NULL OR code_prefix ~ '^[A-Z]{2,5}$');

-- 2. Seta HSL para Santa Luzia
UPDATE public.hospitals SET code_prefix = 'HSL' WHERE slug = 'santa_luzia';

-- 3. next_rule_code passa a preferir code_prefix se definido
CREATE OR REPLACE FUNCTION public.next_rule_code(_hospital_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_slug text; v_prefix text; v_custom text; v_seq int;
BEGIN
  SELECT slug, code_prefix INTO v_slug, v_custom FROM public.hospitals WHERE id = _hospital_id;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Hospital % não encontrado', _hospital_id; END IF;
  IF v_custom IS NOT NULL AND length(trim(v_custom)) > 0 THEN
    v_prefix := upper(trim(v_custom));
  ELSE
    v_prefix := upper(substr(regexp_replace(v_slug, '[^a-zA-Z]', '', 'g'), 1, 3));
    IF length(v_prefix) < 2 THEN v_prefix := upper(substr(v_slug, 1, 3)); END IF;
  END IF;
  SELECT COALESCE(MAX( (regexp_replace(code, '^.*-R0*', ''))::int ), 0) + 1 INTO v_seq
  FROM public.rules WHERE hospital_id = _hospital_id AND code ~ ('^' || v_prefix || '-R[0-9]+$');
  RETURN v_prefix || '-R' || lpad(v_seq::text, 3, '0');
END; $$;

-- 4. Renomeia códigos existentes SAN-R### → HSL-R### no Santa Luzia (bypassa imutabilidade temporariamente)
ALTER TABLE public.rules DISABLE TRIGGER trg_rules_protect_immutable;
UPDATE public.rules
SET code = 'HSL-R' || substring(code FROM '^SAN-R(\d+)$')
WHERE hospital_id = (SELECT id FROM public.hospitals WHERE slug = 'santa_luzia')
  AND code ~ '^SAN-R\d+$';
ALTER TABLE public.rules ENABLE TRIGGER trg_rules_protect_immutable;