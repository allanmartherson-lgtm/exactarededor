
-- ============================================================
-- payment_models (modelos de pagamento do LOTE)
-- ============================================================
CREATE TABLE public.payment_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  calc_strategy text,
  allow_mixed_item_types boolean NOT NULL DEFAULT true,
  expected_headers jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_models TO authenticated;
GRANT ALL ON public.payment_models TO service_role;

ALTER TABLE public.payment_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_models read for authenticated"
  ON public.payment_models FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "payment_models full access for service_role"
  ON public.payment_models FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- item_types (tipos do ITEM / procedimento)
-- ============================================================
CREATE TABLE public.item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  default_function text,
  requires_tuss boolean NOT NULL DEFAULT false,
  is_default_when_no_tuss boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Garante que existe no máximo um "padrão quando não tem TUSS"
CREATE UNIQUE INDEX item_types_one_default_when_no_tuss
  ON public.item_types ((is_default_when_no_tuss))
  WHERE is_default_when_no_tuss = true;

GRANT SELECT ON public.item_types TO authenticated;
GRANT ALL ON public.item_types TO service_role;

ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_types read for authenticated"
  ON public.item_types FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "item_types full access for service_role"
  ON public.item_types FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- updated_at triggers (reusa função padrão se existir, senão cria)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_models_set_updated_at
  BEFORE UPDATE ON public.payment_models
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER item_types_set_updated_at
  BEFORE UPDATE ON public.item_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- Seed inicial — derivado da payment_types atual
-- payment_models: Produção, Plantão, Remessa, Valor fixo
-- ============================================================
INSERT INTO public.payment_models (code, label, sort_order, calc_strategy)
VALUES
  ('producao',   'Produção',   10, 'rules'),
  ('plantao',    'Plantão',    20, 'rules'),
  ('remessa',    'Remessa',    30, 'rules'),
  ('valor_fixo', 'Valor fixo', 40, 'rules')
ON CONFLICT (code) DO NOTHING;

-- item_types: Parecer Adulto, Visita, Cirurgia, Consulta (default), Bônus por paciente, Exames SADT, Exames Cardiologia
INSERT INTO public.item_types
  (code, label, sort_order, requires_tuss, is_default_when_no_tuss)
VALUES
  ('parecer_adulto',     'Parecer Adulto',     10, false, false),
  ('visita',             'Visita',             20, false, false),
  ('cirurgia',           'Cirurgia',           30, true,  false),
  ('consulta',           'Consulta',           40, false, true),  -- default sem TUSS
  ('bonus_paciente',     'Bônus por paciente', 50, false, false),
  ('sadt',               'Exames SADT',        60, true,  false),
  ('exames_cardiologia', 'Exames Cardiologia', 70, true,  false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Novas colunas nas tabelas operacionais
-- ============================================================

-- payments: modelo do lote
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_model_id uuid REFERENCES public.payment_models(id);

CREATE INDEX IF NOT EXISTS payments_payment_model_id_idx
  ON public.payments (payment_model_id);

-- payment_items: tipo do item + source
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES public.item_types(id),
  ADD COLUMN IF NOT EXISTS item_type_source text;

CREATE INDEX IF NOT EXISTS payment_items_item_type_id_idx
  ON public.payment_items (item_type_id);

-- rules: pode escopar por modelo, por tipo de item ou ambos
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS payment_model_id uuid REFERENCES public.payment_models(id),
  ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES public.item_types(id);

CREATE INDEX IF NOT EXISTS rules_payment_model_id_idx
  ON public.rules (payment_model_id);
CREATE INDEX IF NOT EXISTS rules_item_type_id_idx
  ON public.rules (item_type_id);

-- procedure_classifications: mapa TUSS → item_type (tabela está vazia hoje)
ALTER TABLE public.procedure_classifications
  ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES public.item_types(id);

CREATE INDEX IF NOT EXISTS procedure_classifications_item_type_id_idx
  ON public.procedure_classifications (item_type_id);

-- ============================================================
-- Backfill — usa o CODE atual da payment_types para decidir
-- ============================================================

-- Mapa: code antigo -> tabela nova
-- Modelos: producao, plantao, remessa, valor_fixo
-- Itens:   parecer_adulto, visita, cirurgia, consulta, bonus_paciente, sadt, exames_cardiologia

-- payments → payment_model_id
UPDATE public.payments p
SET payment_model_id = pm.id
FROM public.payment_types pt
JOIN public.payment_models pm ON pm.code = pt.code
WHERE p.payment_type_id = pt.id
  AND p.payment_model_id IS NULL
  AND pt.code IN ('producao','plantao','remessa','valor_fixo');

-- payment_items → item_type_id (quando o payment_type atual é um tipo de item)
UPDATE public.payment_items pi
SET item_type_id = it.id,
    item_type_source = COALESCE(pi.item_type_source, 'backfill_from_payment_type')
FROM public.payment_types pt
JOIN public.item_types it ON it.code = pt.code
WHERE pi.payment_type_id = pt.id
  AND pi.item_type_id IS NULL
  AND pt.code IN ('parecer_adulto','visita','cirurgia','consulta','bonus_paciente','sadt','exames_cardiologia');

-- rules → modelo ou tipo de item conforme o code antigo
UPDATE public.rules r
SET payment_model_id = pm.id
FROM public.payment_types pt
JOIN public.payment_models pm ON pm.code = pt.code
WHERE r.payment_type_id = pt.id
  AND r.payment_model_id IS NULL
  AND pt.code IN ('producao','plantao','remessa','valor_fixo');

UPDATE public.rules r
SET item_type_id = it.id
FROM public.payment_types pt
JOIN public.item_types it ON it.code = pt.code
WHERE r.payment_type_id = pt.id
  AND r.item_type_id IS NULL
  AND pt.code IN ('parecer_adulto','visita','cirurgia','consulta','bonus_paciente','sadt','exames_cardiologia');

-- ============================================================
-- Aviso: regras ainda escopadas por payment_type_id que não bateu
-- nem em modelo nem em tipo de item (caso surja algum code novo)
-- ============================================================
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.rules r
  JOIN public.payment_types pt ON pt.id = r.payment_type_id
  WHERE r.payment_model_id IS NULL
    AND r.item_type_id IS NULL
    AND pt.code NOT IN ('producao','plantao','remessa','valor_fixo',
                        'parecer_adulto','visita','cirurgia','consulta',
                        'bonus_paciente','sadt','exames_cardiologia');
  IF v_count > 0 THEN
    RAISE NOTICE 'Atenção: % regras com payment_type_id não mapeadas no backfill — revisar manualmente.', v_count;
  END IF;
END $$;
