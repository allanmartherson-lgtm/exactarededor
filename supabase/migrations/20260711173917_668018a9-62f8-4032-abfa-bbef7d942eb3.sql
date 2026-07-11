
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS bonus_base_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_fixed_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_pct_amount numeric;

COMMENT ON COLUMN public.payment_items.bonus_base_amount IS
  'Base usada para calcular a parte percentual do bônus. Só populado em linhas synthetic_bonus=true.';
COMMENT ON COLUMN public.payment_items.bonus_fixed_amount IS
  'Parte fixa do bônus (bonus_amount). Só populado em linhas synthetic_bonus=true.';
COMMENT ON COLUMN public.payment_items.bonus_pct_amount IS
  'Parte percentual = bonus_base_amount * (bonus_pct/100). Só populado em linhas synthetic_bonus=true.';

WITH bonus_rows AS (
  SELECT pi.id,
         parent.procedure_amount AS parent_amount,
         calc.bonus_amount AS calc_fixed,
         calc.bonus_pct AS calc_pct,
         r.bonus_amount AS rule_fixed,
         r.bonus_pct AS rule_pct
  FROM public.payment_items pi
  LEFT JOIN public.payment_items parent
    ON parent.id::text = pi.origem_referencia
  LEFT JOIN public.rules r ON r.id = pi.applied_rule_id
  LEFT JOIN LATERAL (
    SELECT bonus_amount, bonus_pct
    FROM public.rule_calculations
    WHERE rule_id = pi.applied_rule_id AND calculation_type = 'bonus'
    ORDER BY sort_order NULLS LAST LIMIT 1
  ) calc ON true
  WHERE pi.synthetic_bonus = true
    AND pi.applied_calc_method = 'bonus'
    AND pi.bonus_base_amount IS NULL
)
UPDATE public.payment_items pi
SET bonus_base_amount = br.parent_amount,
    bonus_fixed_amount = COALESCE(br.calc_fixed, br.rule_fixed, 0),
    bonus_pct_amount = ROUND(
      COALESCE(br.parent_amount, 0) * COALESCE(br.calc_pct, br.rule_pct, 0) / 100.0,
      2
    )
FROM bonus_rows br
WHERE pi.id = br.id;

CREATE OR REPLACE FUNCTION public.check_bonus_decomposition()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.synthetic_bonus IS TRUE
     AND NEW.applied_calc_method = 'bonus'
     AND NEW.bonus_fixed_amount IS NOT NULL
     AND NEW.bonus_pct_amount IS NOT NULL
     AND NEW.expected_amount IS NOT NULL
     AND ABS(
       (COALESCE(NEW.bonus_fixed_amount,0) + COALESCE(NEW.bonus_pct_amount,0)) - NEW.expected_amount
     ) > 0.05 THEN
    RAISE EXCEPTION
      'Bonus decomposition mismatch: fixed(%) + pct(%) != expected(%) em payment_item %',
      NEW.bonus_fixed_amount, NEW.bonus_pct_amount, NEW.expected_amount, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_bonus_decomposition ON public.payment_items;
CREATE TRIGGER trg_check_bonus_decomposition
  BEFORE INSERT OR UPDATE OF bonus_fixed_amount, bonus_pct_amount, expected_amount
  ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.check_bonus_decomposition();
