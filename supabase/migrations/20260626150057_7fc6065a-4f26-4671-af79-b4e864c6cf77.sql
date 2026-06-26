-- Índice para acelerar o ON DELETE SET NULL do FK parecer_report_row_id.
-- Sem ele, deletar 2792 linhas de relatório fazia 2792 full-scans em
-- payment_items (milhões de linhas) → statement timeout.
CREATE INDEX IF NOT EXISTS idx_payment_items_parecer_report_row_id
  ON public.payment_items (parecer_report_row_id)
  WHERE parecer_report_row_id IS NOT NULL;

-- Reescreve a função de delete: zera o FK em bulk antes de deletar as linhas
-- (uma única UPDATE em vez de 2792 cascades), e amplia o timeout.
CREATE OR REPLACE FUNCTION public.delete_parecer_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('statement_timeout', '300000', true);

  -- Bulk null no FK para evitar cascade row-a-row.
  UPDATE public.payment_items
     SET parecer_report_row_id = NULL
   WHERE parecer_report_row_id IN (
     SELECT id FROM public.payment_parecer_report_rows
      WHERE report_id = p_report_id
   );

  DELETE FROM public.payment_parecer_report_rows WHERE report_id = p_report_id;
  DELETE FROM public.payment_parecer_reports     WHERE id = p_report_id;
END;
$function$;