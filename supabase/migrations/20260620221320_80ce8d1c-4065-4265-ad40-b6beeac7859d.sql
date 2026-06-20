
-- 1. Estender doctor_link_suggestions
ALTER TABLE public.doctor_link_suggestions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'analyst_manual'
    CHECK (source IN ('analyst_manual','engine_fuzzy','ai_suggested')),
  ADD COLUMN IF NOT EXISTS score NUMERIC,
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('high','low')),
  ADD COLUMN IF NOT EXISTS context_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;

-- 2. company_link_suggestions (companies.id existe)
CREATE TABLE IF NOT EXISTS public.company_link_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  matched_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  source_field TEXT,
  raw_snippet TEXT,
  detected_value TEXT,
  detected_value_normalized TEXT,
  source TEXT NOT NULL DEFAULT 'engine_fuzzy'
    CHECK (source IN ('analyst_manual','engine_fuzzy','ai_suggested')),
  score NUMERIC,
  confidence TEXT CHECK (confidence IN ('high','low')),
  context_jsonb JSONB,
  ai_reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_link_suggestions TO authenticated;
GRANT ALL ON public.company_link_suggestions TO service_role;
ALTER TABLE public.company_link_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view_company_link_suggestions" ON public.company_link_suggestions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_company_link_suggestions" ON public.company_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_update_company_link_suggestions" ON public.company_link_suggestions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. convenio_link_suggestions (convenios usa slug como PK textual)
CREATE TABLE IF NOT EXISTS public.convenio_link_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  convenio_slug TEXT,
  matched_convenio_slug TEXT,
  source_field TEXT,
  raw_snippet TEXT,
  detected_value TEXT,
  detected_value_normalized TEXT,
  source TEXT NOT NULL DEFAULT 'engine_fuzzy'
    CHECK (source IN ('analyst_manual','engine_fuzzy','ai_suggested')),
  score NUMERIC,
  confidence TEXT CHECK (confidence IN ('high','low')),
  context_jsonb JSONB,
  ai_reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convenio_link_suggestions TO authenticated;
GRANT ALL ON public.convenio_link_suggestions TO service_role;
ALTER TABLE public.convenio_link_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view_convenio_link_suggestions" ON public.convenio_link_suggestions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_convenio_link_suggestions" ON public.convenio_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_update_convenio_link_suggestions" ON public.convenio_link_suggestions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. sector_link_suggestions
CREATE TABLE IF NOT EXISTS public.sector_link_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sector_slug TEXT,
  matched_sector_slug TEXT,
  source_field TEXT,
  raw_snippet TEXT,
  detected_value TEXT,
  detected_value_normalized TEXT,
  source TEXT NOT NULL DEFAULT 'engine_fuzzy'
    CHECK (source IN ('analyst_manual','engine_fuzzy','ai_suggested')),
  score NUMERIC,
  confidence TEXT CHECK (confidence IN ('high','low')),
  context_jsonb JSONB,
  ai_reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_link_suggestions TO authenticated;
GRANT ALL ON public.sector_link_suggestions TO service_role;
ALTER TABLE public.sector_link_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view_sector_link_suggestions" ON public.sector_link_suggestions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_sector_link_suggestions" ON public.sector_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_update_sector_link_suggestions" ON public.sector_link_suggestions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. match_telemetry
CREATE TABLE IF NOT EXISTS public.match_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('doctor','company','convenio','sector')),
  suggestion_id UUID,
  payment_item_id UUID,
  rule_id UUID,
  candidate_a TEXT,
  candidate_b TEXT,
  fuzzy_score NUMERIC,
  pillars_matched JSONB,
  ai_invoked BOOLEAN DEFAULT FALSE,
  ai_model TEXT,
  ai_prompt TEXT,
  ai_response JSONB,
  ai_confidence NUMERIC,
  ai_decision BOOLEAN,
  analyst_decision TEXT CHECK (analyst_decision IN ('approved','rejected','pending')),
  analyst_decision_at TIMESTAMPTZ,
  time_to_decision_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.match_telemetry TO authenticated;
GRANT ALL ON public.match_telemetry TO service_role;
ALTER TABLE public.match_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_view_match_telemetry" ON public.match_telemetry
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "insert_match_telemetry" ON public.match_telemetry
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_update_match_telemetry" ON public.match_telemetry
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_match_telemetry_entity_created
  ON public.match_telemetry(entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_telemetry_suggestion
  ON public.match_telemetry(suggestion_id);

-- 6. Feature flags (column name is `key`)
INSERT INTO public.feature_flags (key, enabled, description)
SELECT 'ai_copilot_enabled', true, 'Habilita o copiloto IA transversal (sugestões, explicações, análises)'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'ai_copilot_enabled');

INSERT INTO public.feature_flags (key, enabled, description)
SELECT 'engine_fuzzy_suggestions_enabled', true, 'Habilita o detector de quase-match (Jaro-Winkler) no motor'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'engine_fuzzy_suggestions_enabled');

-- 7. Triggers updated_at
CREATE TRIGGER trg_company_link_suggestions_updated_at
  BEFORE UPDATE ON public.company_link_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_convenio_link_suggestions_updated_at
  BEFORE UPDATE ON public.convenio_link_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sector_link_suggestions_updated_at
  BEFORE UPDATE ON public.sector_link_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
