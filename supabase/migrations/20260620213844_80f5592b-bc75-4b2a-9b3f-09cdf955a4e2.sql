
-- Backfill de target_doctor_id em rules.group_company_links[].doctors[]
-- Regra: só preenche quando o CRM (digits-only) bate UNIVOCAMENTE com
-- exatamente UM médico em public.doctors. Ambíguo ou sem match = mantém
-- como está (analista resolve depois reabrindo a regra).

DO $$
DECLARE
  v_rule RECORD;
  v_links JSONB;
  v_new_links JSONB := '[]'::jsonb;
  v_link JSONB;
  v_docs JSONB;
  v_new_docs JSONB;
  v_doc JSONB;
  v_new_doc JSONB;
  v_crm_digits TEXT;
  v_match_id UUID;
  v_match_count INT;
  v_changed BOOLEAN;
  v_total_changed INT := 0;
  v_total_resolved INT := 0;
  v_total_ambiguous INT := 0;
BEGIN
  FOR v_rule IN
    SELECT id, group_company_links
    FROM public.rules
    WHERE scope = 'grupo'
      AND group_company_links IS NOT NULL
      AND jsonb_typeof(group_company_links::jsonb) = 'array'
  LOOP
    v_links := v_rule.group_company_links::jsonb;
    v_new_links := '[]'::jsonb;
    v_changed := FALSE;

    FOR v_link IN SELECT * FROM jsonb_array_elements(v_links)
    LOOP
      v_docs := COALESCE(v_link->'doctors', '[]'::jsonb);
      v_new_docs := '[]'::jsonb;

      FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs)
      LOOP
        v_new_doc := v_doc;
        -- Só tenta resolver se NÃO tem id e tem CRM
        IF (v_doc->>'id') IS NULL AND COALESCE(v_doc->>'crm','') <> '' THEN
          v_crm_digits := regexp_replace(v_doc->>'crm', '\D', '', 'g');
          IF length(v_crm_digits) >= 3 THEN
            SELECT id, COUNT(*) OVER ()
              INTO v_match_id, v_match_count
            FROM public.doctors
            WHERE regexp_replace(COALESCE(crm,''), '\D', '', 'g') = v_crm_digits
            LIMIT 1;

            IF v_match_count = 1 THEN
              v_new_doc := v_new_doc || jsonb_build_object('id', v_match_id);
              v_changed := TRUE;
              v_total_resolved := v_total_resolved + 1;
            ELSIF v_match_count > 1 THEN
              v_total_ambiguous := v_total_ambiguous + 1;
            END IF;
          END IF;
        END IF;
        v_new_docs := v_new_docs || jsonb_build_array(v_new_doc);
      END LOOP;

      v_new_links := v_new_links || jsonb_build_array(
        jsonb_set(v_link, '{doctors}', v_new_docs)
      );
    END LOOP;

    IF v_changed THEN
      UPDATE public.rules
      SET group_company_links = v_new_links
      WHERE id = v_rule.id;
      v_total_changed := v_total_changed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill concluído: % regras atualizadas, % médicos resolvidos por CRM único, % CRMs ambíguos (mantidos sem id).',
    v_total_changed, v_total_resolved, v_total_ambiguous;
END$$;
