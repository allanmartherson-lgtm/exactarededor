-- Aprendizado de validador: padrões consolidados a partir de feedbacks aceitos

CREATE TABLE public.learned_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('exclusao','ausencia','override_valor','aceitar_divergencia')),
  scope jsonb NOT NULL,
  scope_hash text NOT NULL,
  signal jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrences integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','silenciado','arquivado')),
  silenced_by uuid,
  silenced_at timestamptz,
  silenced_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, kind, scope_hash)
);

CREATE INDEX idx_learned_patterns_lookup ON public.learned_patterns (hospital_id, kind, status);
CREATE INDEX idx_learned_patterns_scope ON public.learned_patterns USING gin (scope);

GRANT SELECT ON public.learned_patterns TO authenticated;
GRANT ALL ON public.learned_patterns TO service_role;

ALTER TABLE public.learned_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patterns: read by hospital members" ON public.learned_patterns
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    EXISTS (SELECT 1 FROM public.user_hospitals uh WHERE uh.user_id = auth.uid() AND uh.hospital_id = learned_patterns.hospital_id)
  );

CREATE TABLE public.learned_pattern_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES public.learned_patterns(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('validation_feedback','item_override','accept_divergence')),
  source_id uuid,
  payment_id uuid,
  payment_item_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lpe_pattern ON public.learned_pattern_events(pattern_id, created_at DESC);
CREATE UNIQUE INDEX uq_lpe_source ON public.learned_pattern_events(source_kind, source_id) WHERE source_id IS NOT NULL;

GRANT SELECT ON public.learned_pattern_events TO authenticated;
GRANT ALL ON public.learned_pattern_events TO service_role;

ALTER TABLE public.learned_pattern_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events: read via pattern" ON public.learned_pattern_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.learned_patterns lp WHERE lp.id = pattern_id AND (
    public.has_role(auth.uid(),'admin') OR EXISTS (SELECT 1 FROM public.user_hospitals uh WHERE uh.user_id=auth.uid() AND uh.hospital_id=lp.hospital_id)
  )));

CREATE TABLE public.payment_item_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_item_id uuid NOT NULL REFERENCES public.payment_items(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL,
  pattern_id uuid NOT NULL REFERENCES public.learned_patterns(id) ON DELETE CASCADE,
  kind text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_item_id, pattern_id)
);
CREATE INDEX idx_pih_item ON public.payment_item_hints(payment_item_id);

GRANT SELECT ON public.payment_item_hints TO authenticated;
GRANT ALL ON public.payment_item_hints TO service_role;

ALTER TABLE public.payment_item_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hints: read by hospital members" ON public.payment_item_hints
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR
    EXISTS (SELECT 1 FROM public.user_hospitals uh WHERE uh.user_id=auth.uid() AND uh.hospital_id=payment_item_hints.hospital_id)
  );

-- Função: canonical hash de scope
CREATE OR REPLACE FUNCTION public.lp_scope_hash(_scope jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(coalesce((SELECT string_agg(key||'='||value, '|' ORDER BY key)
                       FROM jsonb_each_text(_scope)),''))
$$;

-- Trigger fill scope_hash + updated_at
CREATE OR REPLACE FUNCTION public.lp_set_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.scope_hash := public.lp_scope_hash(NEW.scope);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lp_hash BEFORE INSERT OR UPDATE OF scope ON public.learned_patterns
  FOR EACH ROW EXECUTE FUNCTION public.lp_set_hash();

-- Função principal: consome feedback aceito e gera/atualiza padrão
CREATE OR REPLACE FUNCTION public.consume_validation_feedback(_feedback_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fb record;
  v_val record;
  v_item record;
  v_kind text;
  v_scope jsonb;
  v_hash text;
  v_pattern_id uuid;
  v_existing record;
  v_dominant numeric;
  v_total numeric;
  v_agreement numeric;
  v_confidence numeric;
  v_signal jsonb;
BEGIN
  SELECT * INTO v_fb FROM public.production_validation_feedbacks WHERE id = _feedback_id;
  IF NOT FOUND OR v_fb.status <> 'aceito' THEN RETURN NULL; END IF;

  SELECT * INTO v_val FROM public.production_validations WHERE id = v_fb.validation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- já consumido?
  PERFORM 1 FROM public.learned_pattern_events
    WHERE source_kind='validation_feedback' AND source_id = v_fb.id;
  IF FOUND THEN RETURN NULL; END IF;

  IF v_fb.payment_item_id IS NOT NULL THEN
    SELECT id, hospital_id, payment_id, procedure_code, convenio_slug, company_id, doctor_id
      INTO v_item FROM public.payment_items WHERE id = v_fb.payment_item_id;
  END IF;

  IF v_fb.kind = 'exclusao' THEN
    v_kind := 'exclusao';
    v_scope := jsonb_strip_nulls(jsonb_build_object(
      'company_id', v_val.company_id::text,
      'tuss', coalesce(v_item.procedure_code, ''),
      'convenio_slug', coalesce(v_item.convenio_slug, lower(coalesce(v_fb.convenio,''))),
      'exclusion_reason', coalesce(v_fb.exclusion_reason,'outro')
    ));
  ELSIF v_fb.kind = 'ausencia' THEN
    v_kind := 'ausencia';
    v_scope := jsonb_strip_nulls(jsonb_build_object(
      'company_id', v_val.company_id::text,
      'doctor_name', lower(trim(coalesce(v_fb.doctor_name,''))),
      'tuss', coalesce(v_fb.attendance_number,''),
      'convenio_slug', lower(trim(coalesce(v_fb.convenio,'')))
    ));
  ELSE
    RETURN NULL; -- observação não vira padrão
  END IF;

  IF v_val.hospital_id IS NULL THEN RETURN NULL; END IF;

  v_hash := public.lp_scope_hash(v_scope);

  SELECT * INTO v_existing FROM public.learned_patterns
    WHERE hospital_id = v_val.hospital_id AND kind = v_kind AND scope_hash = v_hash;

  IF NOT FOUND THEN
    INSERT INTO public.learned_patterns(hospital_id, kind, scope, scope_hash, occurrences, last_seen_at, signal, confidence)
      VALUES (v_val.hospital_id, v_kind, v_scope, v_hash, 1, now(),
              jsonb_build_object('dominant', coalesce(v_fb.exclusion_reason,'')), LEAST(1.0, 1.0/5.0))
      RETURNING id INTO v_pattern_id;
  ELSE
    v_total := v_existing.occurrences + 1;
    -- agreement = % do motivo dominante
    SELECT count(*)::numeric INTO v_dominant
      FROM public.learned_pattern_events lpe
      JOIN public.production_validation_feedbacks f ON f.id = lpe.source_id
      WHERE lpe.pattern_id = v_existing.id
        AND coalesce(f.exclusion_reason,'') = coalesce(v_fb.exclusion_reason,'');
    v_dominant := v_dominant + 1;
    v_agreement := CASE WHEN v_kind='exclusao' THEN v_dominant / v_total ELSE 1.0 END;
    v_confidence := LEAST(1.0, v_total / 5.0) * v_agreement;
    v_signal := jsonb_build_object(
      'dominant_reason', coalesce(v_fb.exclusion_reason,''),
      'agreement', v_agreement
    );
    UPDATE public.learned_patterns
      SET occurrences = v_total,
          last_seen_at = now(),
          confidence = v_confidence,
          signal = v_signal,
          updated_at = now()
      WHERE id = v_existing.id;
    v_pattern_id := v_existing.id;
  END IF;

  INSERT INTO public.learned_pattern_events(pattern_id, source_kind, source_id, payment_id, payment_item_id, payload)
    VALUES (v_pattern_id, 'validation_feedback', v_fb.id, v_val.payment_id, v_fb.payment_item_id,
            jsonb_build_object('kind', v_fb.kind, 'exclusion_reason', v_fb.exclusion_reason, 'convenio', v_fb.convenio));

  RETURN v_pattern_id;
END $$;

-- Trigger: dispara quando feedback vira aceito
CREATE OR REPLACE FUNCTION public.trg_consume_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status = 'aceito' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'aceito') THEN
    PERFORM public.consume_validation_feedback(NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_pvf_learn
  AFTER INSERT OR UPDATE OF status ON public.production_validation_feedbacks
  FOR EACH ROW EXECUTE FUNCTION public.trg_consume_feedback();

-- RPC: silenciar/arquivar padrão (admin/diretor/senior)
CREATE OR REPLACE FUNCTION public.silence_learned_pattern(_pattern_id uuid, _reason text, _new_status text DEFAULT 'silenciado')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_is_senior boolean;
BEGIN
  IF _new_status NOT IN ('silenciado','arquivado','ativo') THEN
    RAISE EXCEPTION 'status inválido';
  END IF;
  SELECT coalesce(is_senior,false) INTO v_is_senior FROM public.profiles WHERE id = auth.uid();
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor') OR v_is_senior) THEN
    RAISE EXCEPTION 'permissão negada';
  END IF;
  UPDATE public.learned_patterns
    SET status = _new_status,
        silenced_by = CASE WHEN _new_status='ativo' THEN NULL ELSE auth.uid() END,
        silenced_at = CASE WHEN _new_status='ativo' THEN NULL ELSE now() END,
        silenced_reason = CASE WHEN _new_status='ativo' THEN NULL ELSE _reason END,
        updated_at = now()
    WHERE id = _pattern_id;
END $$;

GRANT EXECUTE ON FUNCTION public.silence_learned_pattern(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_validation_feedback(uuid) TO authenticated;