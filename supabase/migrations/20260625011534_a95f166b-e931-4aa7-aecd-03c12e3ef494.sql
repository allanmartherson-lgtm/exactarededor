-- 1) Permite o novo source 'base_tipo' (coluna TIPO da base já tratada pelo analista)
ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_payment_type_source_check;
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_type_source_check
  CHECK (
    payment_type_source IS NULL OR payment_type_source = ANY (ARRAY[
      'base','report_cross','report_cross_dedup','manual','company_override','default','base_tipo','auto_parecer_report'
    ])
  );

-- 2) Reclassifica retroativamente o lote Cardiologia DF Star Maio/2026
WITH ids AS (
  SELECT
    (SELECT id FROM public.payment_types WHERE code='parecer_adulto') AS parecer_id,
    (SELECT id FROM public.payment_types WHERE code='visita')          AS visita_id
)
UPDATE public.payment_items pi
SET
  payment_type_id = CASE
    WHEN lower(pi.raw_data->>'TIPO') = 'parecer' THEN (SELECT parecer_id FROM ids)
    WHEN lower(pi.raw_data->>'TIPO') = 'visita'  THEN (SELECT visita_id  FROM ids)
  END,
  payment_type_source = 'base_tipo',
  manual_intervention_notes = COALESCE(NULLIF(pi.manual_intervention_notes,''),'')
    || CASE WHEN COALESCE(pi.manual_intervention_notes,'')='' THEN '' ELSE E'\n' END
    || 'Reclassificado pela coluna TIPO da base enviada pelo analista.'
WHERE pi.payment_id = '07d999fc-587e-4d78-a2ba-38ab4f7c240f'
  AND lower(pi.raw_data->>'TIPO') IN ('parecer','visita');
