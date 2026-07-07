
-- Troca UNIQUE global por UNIQUE por hospital (code_p12 e code)
ALTER TABLE public.cost_centers DROP CONSTRAINT IF EXISTS cost_centers_code_p12_key;
DROP INDEX IF EXISTS public.cost_centers_code_p12_key;
DROP INDEX IF EXISTS public.cost_centers_code_uidx;

ALTER TABLE public.cost_centers
  ADD CONSTRAINT cost_centers_hospital_code_p12_key UNIQUE (hospital_id, code_p12);
CREATE UNIQUE INDEX cost_centers_hospital_code_uidx
  ON public.cost_centers (hospital_id, code);

-- Clona catálogo do DF Star para Santa Helena e Santa Luzia
DO $$
DECLARE
  df_star_id uuid := '28dffeb5-e0d2-48fb-951b-58419d41e372';
  helena_id uuid := '9168b14a-6974-4a58-9276-92b49a6fe316';
  luzia_id uuid := 'fe55d20f-0d4f-477f-871d-e53866f6b02c';
  target_id uuid;
  target_name text;
  hospital_target uuid;
  seed_import_id uuid;
  created_n int;
  seed_actor uuid;
BEGIN
  SELECT ur.user_id INTO seed_actor
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.user_id
    LIMIT 1;

  FOR target_id, target_name IN
    SELECT * FROM (VALUES (helena_id, 'Santa Helena'), (luzia_id, 'Santa Luzia')) AS t(id, name)
  LOOP
    hospital_target := target_id;

    INSERT INTO public.cost_center_imports (
      hospital_id, file_name, rows_in_file, created_count, updated_count,
      deactivated_count, imported_by, status, snapshot
    ) VALUES (
      hospital_target,
      'seed_from_df_star_' || target_name || '.internal',
      0, 0, 0, 0, seed_actor, 'aplicada', '[]'::jsonb
    ) RETURNING id INTO seed_import_id;

    WITH inserted AS (
      INSERT INTO public.cost_centers (
        hospital_id, code_p12, code_p10, code_pai,
        level1, level2, level3, level4, level5,
        status, active, imported_at, imported_by, code
      )
      SELECT
        hospital_target, src.code_p12, src.code_p10, src.code_pai,
        src.level1, src.level2, src.level3, src.level4, src.level5,
        src.status, true, now(), seed_actor, src.code
      FROM public.cost_centers src
      WHERE src.hospital_id = df_star_id
        AND src.active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.cost_centers dst
          WHERE dst.hospital_id = hospital_target
            AND dst.code_p12 = src.code_p12
        )
      RETURNING 1
    )
    SELECT count(*) INTO created_n FROM inserted;

    UPDATE public.cost_center_imports
      SET rows_in_file = created_n, created_count = created_n
      WHERE id = seed_import_id;

    RAISE NOTICE 'Seed % : % centros clonados', target_name, created_n;
  END LOOP;
END $$;
