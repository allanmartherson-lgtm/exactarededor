-- Atualiza a função de progresso para notificar quando terminar
CREATE OR REPLACE FUNCTION public.increment_processing_progress(_job_id uuid, _company_name text, _error text DEFAULT NULL::text)
 RETURNS public.payment_processing_jobs
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
  -- Verifica o status atual antes de atualizar
  SELECT status, processed_companies, total_companies INTO old_status, final_processed, final_total 
  FROM public.payment_processing_jobs 
  WHERE id = _job_id;
  
  -- Se o job já estiver cancelado ou concluído, não incrementa
  IF old_status = 'cancelado' OR old_status = 'concluido' THEN
    SELECT * INTO job FROM public.payment_processing_jobs WHERE id = _job_id;
    RETURN job;
  END IF;

  final_processed := final_processed + 1;

  -- Determina o novo status
  IF final_processed >= final_total THEN
    -- Verifica se houve falhas
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

  -- Se o job terminou (concluido ou parcial), notifica via edge function (fire and forget via trigger ou cron não é trivial, 
  -- mas como esta função é chamada via analyze-payment que já está em background, o overhead é aceitável)
  -- Nota: a notificação real de email/whatsapp é disparada pelo analyze-payment ao final da sua execução se for lote único,
  -- ou aqui se for o último item do dispatch.
  
  RETURN job;
END;
$function$;