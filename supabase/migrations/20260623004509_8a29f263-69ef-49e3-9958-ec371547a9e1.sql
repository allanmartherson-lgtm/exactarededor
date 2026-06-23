
-- 1) Tabela de motivos
CREATE TABLE public.manual_intervention_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('reclassificacao_clinica','aceite_financeiro')),
  description text NULL,
  is_seed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Unicidade: code global (hospital_id null) ou code por hospital
CREATE UNIQUE INDEX manual_intervention_reasons_code_global_uk
  ON public.manual_intervention_reasons (code) WHERE hospital_id IS NULL;
CREATE UNIQUE INDEX manual_intervention_reasons_code_hospital_uk
  ON public.manual_intervention_reasons (hospital_id, code) WHERE hospital_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_intervention_reasons TO authenticated;
GRANT ALL ON public.manual_intervention_reasons TO service_role;

ALTER TABLE public.manual_intervention_reasons ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer authenticated vê seeds + motivos do hospital ativo (apps já filtram por hospital_id)
CREATE POLICY "manual_intervention_reasons select all authenticated"
  ON public.manual_intervention_reasons FOR SELECT TO authenticated
  USING (true);

-- CRUD restrito a admin
CREATE POLICY "manual_intervention_reasons admin insert"
  ON public.manual_intervention_reasons FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "manual_intervention_reasons admin update"
  ON public.manual_intervention_reasons FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND is_seed = false);

CREATE POLICY "manual_intervention_reasons admin delete non seed"
  ON public.manual_intervention_reasons FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND is_seed = false);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.tg_manual_intervention_reasons_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_intervention_reasons_set_updated_at
  BEFORE UPDATE ON public.manual_intervention_reasons
  FOR EACH ROW EXECUTE FUNCTION public.tg_manual_intervention_reasons_updated_at();

-- 2) Seeds
INSERT INTO public.manual_intervention_reasons (code, label, category, description, is_seed, sort_order) VALUES
  ('visita_sequencial_parecer', 'Visita sequencial (parecer já cobrado)', 'reclassificacao_clinica',
   'Item com TUSS de parecer mas que é, clinicamente, visita sequencial após o parecer inicial. Pago pelo convênio.', true, 10),
  ('tuss_ambiguo', 'Procedimento com TUSS ambíguo', 'reclassificacao_clinica',
   'TUSS que representa mais de um ato clínico distinto e a regra tipada não se aplica a este caso.', true, 20),
  ('outro_clinico', 'Outro motivo clínico', 'reclassificacao_clinica',
   'Reclassificação clínica não coberta pelos motivos acima — descreva nas observações.', true, 90),
  ('reclassificacao_legado', 'Reclassificação clínica (legado)', 'reclassificacao_clinica',
   'Itens migrados do antigo "Exceção do cálculo". Revisar e recategorizar quando possível.', true, 999),
  ('acatar_risco', 'Acatar divergência (aceito o risco)', 'aceite_financeiro',
   'Concordo com a diferença entre regra e valor pago — assumo o risco financeiro.', true, 10),
  ('valor_negociado', 'Valor negociado fora da regra', 'aceite_financeiro',
   'Existe negociação pontual com o médico/empresa que sobrepõe a regra padrão neste item.', true, 20),
  ('outro_financeiro', 'Outro motivo financeiro', 'aceite_financeiro',
   'Aceite financeiro não coberto pelos motivos acima — descreva nas observações.', true, 90),
  ('acatar_divergencia_legado', 'Acatar divergência (legado)', 'aceite_financeiro',
   'Itens migrados do antigo "Acatado". Revisar e recategorizar quando possível.', true, 999);

-- 3) Campos em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS manual_intervention_reason_id uuid NULL
    REFERENCES public.manual_intervention_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_intervention_notes text NULL,
  ADD COLUMN IF NOT EXISTS manual_intervention_by uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_intervention_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS manual_intervention_source text NULL
    CHECK (manual_intervention_source IS NULL OR manual_intervention_source IN ('manual','auto_parecer_report'));

CREATE INDEX IF NOT EXISTS payment_items_manual_intervention_reason_idx
  ON public.payment_items (manual_intervention_reason_id)
  WHERE manual_intervention_reason_id IS NOT NULL;

-- 4) Trigger sanitiza by/at/source ao mudar o motivo
CREATE OR REPLACE FUNCTION public.tg_payment_items_manual_intervention()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.manual_intervention_reason_id IS NOT NULL AND NEW.manual_intervention_at IS NULL THEN
      NEW.manual_intervention_at := now();
      IF NEW.manual_intervention_source IS NULL THEN
        NEW.manual_intervention_source := 'manual';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.manual_intervention_reason_id IS DISTINCT FROM OLD.manual_intervention_reason_id THEN
    IF NEW.manual_intervention_reason_id IS NULL THEN
      NEW.manual_intervention_notes := NULL;
      NEW.manual_intervention_by := NULL;
      NEW.manual_intervention_at := NULL;
      NEW.manual_intervention_source := NULL;
    ELSE
      NEW.manual_intervention_at := now();
      IF NEW.manual_intervention_source IS NULL THEN
        NEW.manual_intervention_source := 'manual';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_items_manual_intervention_set
  BEFORE INSERT OR UPDATE OF manual_intervention_reason_id
  ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_items_manual_intervention();

-- 5) Migração de dados legados
-- 5a) calc_exception_skip = true → reclassificacao_legado
UPDATE public.payment_items pi
SET manual_intervention_reason_id = r.id,
    manual_intervention_notes = COALESCE(pi.calc_exception_reason, 'Migrado de Exceção do cálculo'),
    manual_intervention_by = pi.calc_exception_marked_by,
    manual_intervention_at = COALESCE(pi.calc_exception_marked_at, now()),
    manual_intervention_source = 'manual'
FROM public.manual_intervention_reasons r
WHERE r.code = 'reclassificacao_legado'
  AND pi.calc_exception_skip = true
  AND pi.manual_intervention_reason_id IS NULL;

-- 5b) ai_status = 'acatado' → acatar_divergencia_legado
UPDATE public.payment_items pi
SET manual_intervention_reason_id = r.id,
    manual_intervention_notes = 'Migrado de Acatado (ai_status)',
    manual_intervention_by = pi.acatado_by,
    manual_intervention_at = COALESCE(pi.acatado_at, now()),
    manual_intervention_source = 'manual'
FROM public.manual_intervention_reasons r
WHERE r.code = 'acatar_divergencia_legado'
  AND pi.ai_status = 'acatado'
  AND pi.manual_intervention_reason_id IS NULL;
