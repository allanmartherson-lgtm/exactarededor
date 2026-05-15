CREATE OR REPLACE FUNCTION public.increment_processing_progress(_job_id uuid, _company_name text, _error text DEFAULT NULL::text)
 RETURNS payment_processing_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  job public.payment_processing_jobs;
  current_status text;
  old_status text;
  new_status text;
  final_processed int;
  final_total int;
BEGIN
  SELECT status, processed_companies, total_companies INTO old_status, final_processed, final_total 
  FROM public.payment_processing_jobs 
  WHERE id = _job_id;

  IF old_status IN ('cancelado', 'concluido', 'parcial') THEN
    SELECT * INTO job FROM public.payment_processing_jobs WHERE id = _job_id;
    RETURN job;
  END IF;

  final_processed := LEAST(final_processed + 1, final_total);

  IF final_processed >= final_total THEN
    IF jsonb_array_length(
      CASE WHEN _error IS NULL THEN (SELECT failed_companies FROM public.payment_processing_jobs WHERE id = _job_id)
           ELSE (SELECT failed_companies FROM public.payment_processing_jobs WHERE id = _job_id) || jsonb_build_object('company_name', _company_name, 'error', _error)
      END
    ) > 0 THEN 
      new_status := 'parcial'; 
    ELSE 
      new_status := 'concluido'; 
    END IF;
  ELSE
    new_status := 'em_andamento';
  END IF;

  UPDATE public.payment_processing_jobs
  SET processed_companies = final_processed,
      failed_companies = CASE
        WHEN _error IS NULL THEN failed_companies
        ELSE failed_companies || jsonb_build_object('company_name', _company_name, 'error', _error, 'at', now())
      END,
      finished_at = CASE
        WHEN final_processed >= total_companies THEN now()
        ELSE finished_at
      END,
      status = new_status
  WHERE id = _job_id
  RETURNING * INTO job;

  RETURN job;
END;
$function$;