
CREATE TABLE public.system_parameter_defs (
  key text PRIMARY KEY,
  category text NOT NULL,
  label text NOT NULL,
  description text,
  json_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.system_parameter_defs TO authenticated;
GRANT ALL ON public.system_parameter_defs TO service_role;

ALTER TABLE public.system_parameter_defs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "params_defs_read_auth" ON public.system_parameter_defs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "params_defs_admin_write" ON public.system_parameter_defs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.system_parameter_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  def_key text NOT NULL REFERENCES public.system_parameter_defs(key) ON DELETE CASCADE,
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  convenio_slug text REFERENCES public.convenios(slug) ON DELETE CASCADE,
  specialty text,
  value jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text,
  priority int GENERATED ALWAYS AS (
    (CASE WHEN hospital_id   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN convenio_slug IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN specialty     IS NOT NULL THEN 1 ELSE 0 END)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT system_parameter_overrides_scope_not_empty CHECK (
    hospital_id IS NOT NULL OR convenio_slug IS NOT NULL OR specialty IS NOT NULL
  )
);

CREATE INDEX ix_param_overrides_lookup
  ON public.system_parameter_overrides (def_key, active, priority DESC);
CREATE UNIQUE INDEX uq_param_overrides_scope
  ON public.system_parameter_overrides (
    def_key,
    COALESCE(hospital_id::text, ''),
    COALESCE(convenio_slug, ''),
    COALESCE(lower(btrim(specialty)), '')
  );

GRANT SELECT ON public.system_parameter_overrides TO authenticated;
GRANT ALL ON public.system_parameter_overrides TO service_role;

ALTER TABLE public.system_parameter_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "params_overrides_read_auth" ON public.system_parameter_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "params_overrides_admin_write" ON public.system_parameter_overrides
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_param_defs_updated_at
  BEFORE UPDATE ON public.system_parameter_defs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tg_param_overrides_updated_at
  BEFORE UPDATE ON public.system_parameter_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.resolve_system_parameter(
  p_key text,
  p_hospital_id uuid DEFAULT NULL,
  p_convenio_slug text DEFAULT NULL,
  p_specialty text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default jsonb;
  v_override jsonb;
  v_spec text := lower(btrim(coalesce(p_specialty, '')));
  v_conv text := lower(btrim(coalesce(p_convenio_slug, '')));
BEGIN
  SELECT value INTO v_default FROM public.system_parameter_defs WHERE key = p_key;
  IF v_default IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_override
  FROM public.system_parameter_overrides
  WHERE def_key = p_key
    AND active = true
    AND (hospital_id   IS NULL OR hospital_id = p_hospital_id)
    AND (convenio_slug IS NULL OR lower(btrim(convenio_slug)) = v_conv)
    AND (specialty     IS NULL OR lower(btrim(specialty)) = v_spec)
  ORDER BY priority DESC, updated_at DESC
  LIMIT 1;

  RETURN COALESCE(v_default || COALESCE(v_override, '{}'::jsonb), v_default);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_system_parameter(text, uuid, text, text) TO authenticated, service_role;

INSERT INTO public.system_parameter_defs (key, category, label, description, json_schema, value)
VALUES (
  'parecer.classification',
  'parecer',
  'Classificação Parecer / Visita',
  'Define quando um parecer é rebaixado para visita por consecutividade. consecutive_days_to_visita = quantos dias consecutivos disparam a regra (1 = só dia imediatamente seguinte). dedup_key = como agrupar os itens (specialty | doctor | doctor_or_specialty). enabled = se a reclassificação automática está ativa.',
  jsonb_build_object(
    'type','object',
    'properties', jsonb_build_object(
      'consecutive_days_to_visita', jsonb_build_object('type','integer','minimum',1,'maximum',30,'default',1),
      'dedup_key',                  jsonb_build_object('type','string','enum', jsonb_build_array('specialty','doctor','doctor_or_specialty'),'default','specialty'),
      'enabled',                    jsonb_build_object('type','boolean','default',true)
    ),
    'required', jsonb_build_array('consecutive_days_to_visita','dedup_key','enabled')
  ),
  jsonb_build_object(
    'consecutive_days_to_visita', 1,
    'dedup_key', 'specialty',
    'enabled', true
  )
);
