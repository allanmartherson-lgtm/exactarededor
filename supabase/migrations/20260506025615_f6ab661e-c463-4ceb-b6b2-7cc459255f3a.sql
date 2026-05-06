
CREATE TABLE public.rule_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  label text,

  -- cálculo
  calculation_type rule_calculation_type NOT NULL DEFAULT 'informativo',
  fixed_amount numeric,
  target_amount numeric,
  multiplier numeric,
  deflator_pct numeric,
  bonus_amount numeric,
  bonus_pct numeric,
  reference_table_id uuid,
  repasse_pct numeric,
  convenio_percentage numeric,
  auxiliary_pct numeric,
  aux_first_pct numeric,
  aux_second_pct numeric,
  instrumentador_pct numeric,
  include_auxiliaries boolean NOT NULL DEFAULT false,
  package_amount numeric,
  package_subtype text,
  package_main_code text,
  package_included_codes text[],
  package_auxiliaries_included boolean NOT NULL DEFAULT true,
  package_opinions_count boolean NOT NULL DEFAULT false,
  package_visits_count boolean NOT NULL DEFAULT false,
  extras_codes text[],
  apply_access_route boolean NOT NULL DEFAULT false,

  -- condições deste cálculo
  time_mode text NOT NULL DEFAULT 'qualquer',
  weekdays smallint[] NOT NULL DEFAULT '{}',
  time_start time without time zone,
  time_end time without time zone,
  includes_holidays boolean NOT NULL DEFAULT false,
  elective_mode text NOT NULL DEFAULT 'qualquer',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rule_calculations_rule_id_idx ON public.rule_calculations(rule_id, sort_order);

CREATE TRIGGER rule_calculations_touch_updated_at
BEFORE UPDATE ON public.rule_calculations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.rule_calculations ENABLE ROW LEVEL SECURITY;

CREATE POLICY rc_view_authenticated ON public.rule_calculations
FOR SELECT TO authenticated USING (true);

CREATE POLICY rc_manage_admin_diretor ON public.rule_calculations
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

-- Backfill: 1 linha por regra existente
INSERT INTO public.rule_calculations (
  rule_id, sort_order, calculation_type,
  fixed_amount, target_amount, multiplier, deflator_pct,
  bonus_amount, bonus_pct, reference_table_id, repasse_pct, convenio_percentage,
  auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, include_auxiliaries,
  package_amount, package_subtype, package_main_code, package_included_codes,
  package_auxiliaries_included, package_opinions_count, package_visits_count,
  extras_codes, apply_access_route,
  time_mode, weekdays, time_start, time_end, includes_holidays, elective_mode
)
SELECT
  id, 0, calculation_type,
  fixed_amount, target_amount, multiplier, deflator_pct,
  bonus_amount, bonus_pct, reference_table_id, repasse_pct, convenio_percentage,
  auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, COALESCE(include_auxiliaries,false),
  package_amount, package_subtype, package_main_code, package_included_codes,
  COALESCE(package_auxiliaries_included,true), COALESCE(package_opinions_count,false), COALESCE(package_visits_count,false),
  extras_codes, COALESCE(apply_access_route,false),
  COALESCE(time_mode,'qualquer'), COALESCE(weekdays,'{}'::smallint[]), time_start, time_end,
  COALESCE(includes_holidays,false), COALESCE(elective_mode,'qualquer')
FROM public.rules;
