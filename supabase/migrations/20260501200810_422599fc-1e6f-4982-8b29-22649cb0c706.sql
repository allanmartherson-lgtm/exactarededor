-- Histórico de importações
CREATE TABLE public.cost_center_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text,
  rows_in_file integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  deactivated_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  imported_by uuid NOT NULL,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'aplicada',
  reverted_by uuid,
  reverted_at timestamp with time zone
);

CREATE INDEX idx_cost_center_imports_recent ON public.cost_center_imports(imported_at DESC);

ALTER TABLE public.cost_center_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cc_imports_view_authenticated"
  ON public.cost_center_imports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cc_imports_manage_admin_diretor"
  ON public.cost_center_imports FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

-- Função de desfazer (restaura snapshot)
CREATE OR REPLACE FUNCTION public.revert_cost_center_import(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  imp public.cost_center_imports;
  latest_id uuid;
  restored integer := 0;
  removed integer := 0;
BEGIN
  -- Permissão
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin ou diretor podem desfazer importações';
  END IF;

  SELECT * INTO imp FROM public.cost_center_imports WHERE id = _import_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;

  IF imp.status <> 'aplicada' THEN
    RAISE EXCEPTION 'Esta importação já foi revertida';
  END IF;

  -- Só permite desfazer a mais recente aplicada
  SELECT id INTO latest_id
  FROM public.cost_center_imports
  WHERE status = 'aplicada'
  ORDER BY imported_at DESC
  LIMIT 1;

  IF latest_id <> _import_id THEN
    RAISE EXCEPTION 'Apenas a última importação aplicada pode ser desfeita';
  END IF;

  -- Apaga centros que não existiam no snapshot (foram criados por esta importação)
  WITH snap_codes AS (
    SELECT (s->>'code_p12') AS code FROM jsonb_array_elements(imp.snapshot) s
  ),
  del AS (
    DELETE FROM public.cost_centers
    WHERE code_p12 NOT IN (SELECT code FROM snap_codes)
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;

  -- Restaura cada linha do snapshot (UPSERT)
  WITH src AS (
    SELECT
      (s->>'code_p12')          AS code_p12,
      NULLIF(s->>'code_p10','')  AS code_p10,
      NULLIF(s->>'code_pai','')  AS code_pai,
      NULLIF(s->>'level1','')    AS level1,
      NULLIF(s->>'level2','')    AS level2,
      NULLIF(s->>'level3','')    AS level3,
      NULLIF(s->>'level4','')    AS level4,
      NULLIF(s->>'level5','')    AS level5,
      NULLIF(s->>'status','')    AS status,
      COALESCE((s->>'active')::boolean, true) AS active
    FROM jsonb_array_elements(imp.snapshot) s
  ),
  ups AS (
    INSERT INTO public.cost_centers
      (code_p12, code_p10, code_pai, level1, level2, level3, level4, level5, status, active)
    SELECT code_p12, code_p10, code_pai, level1, level2, level3, level4, level5, status, active
    FROM src
    ON CONFLICT (code_p12) DO UPDATE SET
      code_p10 = EXCLUDED.code_p10,
      code_pai = EXCLUDED.code_pai,
      level1   = EXCLUDED.level1,
      level2   = EXCLUDED.level2,
      level3   = EXCLUDED.level3,
      level4   = EXCLUDED.level4,
      level5   = EXCLUDED.level5,
      status   = EXCLUDED.status,
      active   = EXCLUDED.active
    RETURNING 1
  )
  SELECT count(*) INTO restored FROM ups;

  -- Marca como revertida
  UPDATE public.cost_center_imports
     SET status = 'revertida',
         reverted_by = auth.uid(),
         reverted_at = now()
   WHERE id = _import_id;

  RETURN jsonb_build_object(
    'restored', restored,
    'removed', removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revert_cost_center_import(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revert_cost_center_import(uuid) TO authenticated;