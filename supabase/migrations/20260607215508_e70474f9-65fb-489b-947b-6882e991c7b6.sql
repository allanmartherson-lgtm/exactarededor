CREATE TABLE IF NOT EXISTS public.doctor_link_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  source_field text NOT NULL DEFAULT 'doctors.notes',
  raw_snippet text,
  detected_kind text NOT NULL CHECK (detected_kind IN ('cnpj', 'crm')),
  detected_value text NOT NULL,
  detected_value_normalized text NOT NULL,
  matched_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  matched_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  auto_resolution text CHECK (auto_resolution IN ('linked', 'pending_no_match', 'pending_ambiguous', 'pending_inactive')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_linked')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, detected_kind, detected_value_normalized)
);

CREATE INDEX IF NOT EXISTS idx_dls_status ON public.doctor_link_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_dls_doctor ON public.doctor_link_suggestions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dls_company ON public.doctor_link_suggestions(matched_company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_link_suggestions TO authenticated;
GRANT ALL ON public.doctor_link_suggestions TO service_role;

ALTER TABLE public.doctor_link_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/diretor podem ler sugestões de vínculo" ON public.doctor_link_suggestions;
CREATE POLICY "Admin/diretor podem ler sugestões de vínculo"
  ON public.doctor_link_suggestions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

DROP POLICY IF EXISTS "Admin/diretor podem gerenciar sugestões de vínculo" ON public.doctor_link_suggestions;
CREATE POLICY "Admin/diretor podem gerenciar sugestões de vínculo"
  ON public.doctor_link_suggestions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

DROP TRIGGER IF EXISTS trg_dls_updated_at ON public.doctor_link_suggestions;
CREATE TRIGGER trg_dls_updated_at
  BEFORE UPDATE ON public.doctor_link_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_doctor_notes_scan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_match text;
  v_digits text;
  v_company_id uuid;
BEGIN
  IF NEW.notes IS NULL OR length(trim(NEW.notes)) = 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.notes, '') = COALESCE(NEW.notes, '') THEN
    RETURN NEW;
  END IF;

  FOR v_row IN
    SELECT (regexp_matches(NEW.notes, '(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})', 'g')) AS m
  LOOP
    v_match := v_row.m[1];
    v_digits := regexp_replace(v_match, '[^0-9]', '', 'g');
    IF length(v_digits) = 14 THEN
      SELECT id INTO v_company_id FROM public.companies
        WHERE regexp_replace(COALESCE(document,''), '[^0-9]', '', 'g') = v_digits
        LIMIT 1;

      INSERT INTO public.doctor_link_suggestions (
        doctor_id, source_field, raw_snippet,
        detected_kind, detected_value, detected_value_normalized,
        matched_company_id, auto_resolution, status
      ) VALUES (
        NEW.id, 'doctors.notes', substring(NEW.notes from 1 for 500),
        'cnpj', v_match, v_digits,
        v_company_id,
        CASE WHEN v_company_id IS NOT NULL THEN 'linked' ELSE 'pending_no_match' END,
        'pending'
      )
      ON CONFLICT (doctor_id, detected_kind, detected_value_normalized) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doctors_notes_scan ON public.doctors;
CREATE TRIGGER trg_doctors_notes_scan
  AFTER INSERT OR UPDATE OF notes ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_doctor_notes_scan();

-- Função RPC para o painel admin: varre todos os médicos existentes (one-shot)
CREATE OR REPLACE FUNCTION public.scan_all_doctor_notes()
RETURNS TABLE(scanned int, suggestions_created int, matched int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor record;
  v_row record;
  v_match text;
  v_digits text;
  v_company_id uuid;
  v_scanned int := 0;
  v_created int := 0;
  v_matched int := 0;
  v_inserted boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_doctor IN SELECT id, notes FROM public.doctors WHERE notes IS NOT NULL AND length(trim(notes)) > 0 LOOP
    v_scanned := v_scanned + 1;
    FOR v_row IN
      SELECT (regexp_matches(v_doctor.notes, '(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})', 'g')) AS m
    LOOP
      v_match := v_row.m[1];
      v_digits := regexp_replace(v_match, '[^0-9]', '', 'g');
      IF length(v_digits) = 14 THEN
        SELECT id INTO v_company_id FROM public.companies
          WHERE regexp_replace(COALESCE(document,''), '[^0-9]', '', 'g') = v_digits
          LIMIT 1;

        WITH ins AS (
          INSERT INTO public.doctor_link_suggestions (
            doctor_id, source_field, raw_snippet,
            detected_kind, detected_value, detected_value_normalized,
            matched_company_id, auto_resolution, status
          ) VALUES (
            v_doctor.id, 'doctors.notes', substring(v_doctor.notes from 1 for 500),
            'cnpj', v_match, v_digits,
            v_company_id,
            CASE WHEN v_company_id IS NOT NULL THEN 'linked' ELSE 'pending_no_match' END,
            'pending'
          )
          ON CONFLICT (doctor_id, detected_kind, detected_value_normalized) DO NOTHING
          RETURNING 1
        )
        SELECT EXISTS(SELECT 1 FROM ins) INTO v_inserted;
        IF v_inserted THEN
          v_created := v_created + 1;
          IF v_company_id IS NOT NULL THEN v_matched := v_matched + 1; END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_created, v_matched;
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_all_doctor_notes() TO authenticated;