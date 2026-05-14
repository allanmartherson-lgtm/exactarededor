-- Atualiza a função de progresso para respeitar o status de cancelamento
CREATE OR REPLACE FUNCTION public.increment_processing_progress(_job_id uuid, _company_name text, _error text DEFAULT NULL::text)
 RETURNS public.payment_processing_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  job public.payment_processing_jobs;
  current_status text;
BEGIN
  -- Verifica o status atual antes de atualizar
  SELECT status INTO current_status FROM public.payment_processing_jobs WHERE id = _job_id;
  
  -- Se o job já estiver cancelado ou concluído, não incrementa
  IF current_status = 'cancelado' OR current_status = 'concluido' THEN
    SELECT * INTO job FROM public.payment_processing_jobs WHERE id = _job_id;
    RETURN job;
  END IF;

  UPDATE public.payment_processing_jobs
  SET processed_companies = processed_companies + 1,
      failed_companies = CASE
        WHEN _error IS NULL THEN failed_companies
        ELSE failed_companies || jsonb_build_object('company_name', _company_name, 'error', _error, 'at', now())
      END,
      finished_at = CASE
        WHEN processed_companies + 1 >= total_companies THEN now()
        ELSE finished_at
      END,
      status = CASE
        WHEN processed_companies + 1 >= total_companies THEN
          CASE WHEN jsonb_array_length(
            CASE WHEN _error IS NULL THEN failed_companies
                 ELSE failed_companies || jsonb_build_object('company_name', _company_name, 'error', _error)
            END
          ) > 0 THEN 'parcial' ELSE 'concluido' END
        ELSE 'em_andamento'
      END
  WHERE id = _job_id
  RETURNING * INTO job;
  RETURN job;
END;
$function$;