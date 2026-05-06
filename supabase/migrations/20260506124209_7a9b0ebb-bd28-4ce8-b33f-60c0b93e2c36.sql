CREATE OR REPLACE FUNCTION public.validate_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d text;
  ddd int;
  age_years numeric;
  valid_ddds int[] := ARRAY[
    11,12,13,14,15,16,17,18,19,
    21,22,24,27,28,
    31,32,33,34,35,37,38,
    41,42,43,44,45,46,47,48,49,
    51,53,54,55,
    61,62,63,64,65,66,67,68,69,
    71,73,74,75,77,79,
    81,82,83,84,85,86,87,88,89,
    91,92,93,94,95,96,97,98,99
  ];
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    d := regexp_replace(NEW.phone, '\D', '', 'g');
    IF length(d) <> 11 THEN
      RAISE EXCEPTION 'Telefone inválido: use DDD + 9 + 8 dígitos (11 números)'
        USING ERRCODE = 'check_violation';
    END IF;
    ddd := substring(d from 1 for 2)::int;
    IF NOT (ddd = ANY(valid_ddds)) THEN
      RAISE EXCEPTION 'Telefone inválido: DDD % não é válido', ddd
        USING ERRCODE = 'check_violation';
    END IF;
    IF substring(d from 3 for 1) <> '9' THEN
      RAISE EXCEPTION 'Telefone inválido: celular deve começar com 9 após o DDD'
        USING ERRCODE = 'check_violation';
    END IF;
    IF d ~ '^(\d)\1{10}$' THEN
      RAISE EXCEPTION 'Telefone inválido: dígitos repetidos'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.phone := d;
  END IF;

  IF NEW.birth_date IS NOT NULL THEN
    IF NEW.birth_date < DATE '1900-01-01' THEN
      RAISE EXCEPTION 'Data de nascimento anterior a 1900'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.birth_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Data de nascimento não pode estar no futuro'
        USING ERRCODE = 'check_violation';
    END IF;
    age_years := EXTRACT(EPOCH FROM (CURRENT_DATE::timestamp - NEW.birth_date::timestamp)) / (365.25 * 86400);
    IF age_years < 14 THEN
      RAISE EXCEPTION 'Idade mínima é 14 anos'
        USING ERRCODE = 'check_violation';
    END IF;
    IF age_years > 120 THEN
      RAISE EXCEPTION 'Idade máxima é 120 anos'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_fields ON public.profiles;
CREATE TRIGGER profiles_validate_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_profile_fields();