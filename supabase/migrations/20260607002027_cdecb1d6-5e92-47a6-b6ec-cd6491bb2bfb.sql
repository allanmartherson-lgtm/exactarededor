-- Trigger que, ao mudar approval_status de 'pending' para 'approved'/'rejected',
-- chama as edge functions de notificação (analista) e disparo (broadcast) via pg_net.

CREATE OR REPLACE FUNCTION public.on_campaign_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text := 'https://bexwvmnwsbltrspmwusp.supabase.co/functions/v1';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJleHd2bW53c2JsdHJzcG13dXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODU5MDEsImV4cCI6MjA5MzQ2MTkwMX0.4w1JWwd1NsKZvScJIuOHcJubRrWMlScrD1oHj8jBRtQ';
  v_headers jsonb;
BEGIN
  -- Só age quando saiu de pending para approved/rejected
  IF NOT (OLD.approval_status = 'pending'
          AND NEW.approval_status IN ('approved','rejected')) THEN
    RETURN NEW;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization', 'Bearer ' || v_anon
  );

  -- Notifica analista (inbox + email) — sempre
  BEGIN
    PERFORM net.http_post(
      url := v_base || '/notify-campaign-decision',
      headers := v_headers,
      body := jsonb_build_object(
        'campaign_id', NEW.id,
        'decision', NEW.approval_status,
        'reason', NEW.rejection_reason
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'notify-campaign-decision falhou: % %', SQLERRM, SQLSTATE;
  END;

  -- Aprovação: dispara broadcast imediatamente se não estiver agendado para o futuro
  IF NEW.approval_status = 'approved'
     AND (NEW.scheduled_for IS NULL OR NEW.scheduled_for <= now())
     AND NEW.status IN ('rascunho','agendada','falhou') THEN
    BEGIN
      PERFORM net.http_post(
        url := v_base || '/dispatch-broadcast',
        headers := v_headers,
        body := jsonb_build_object('campaign_id', NEW.id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'dispatch-broadcast falhou: % %', SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_campaign_decision ON public.comm_campaigns;
CREATE TRIGGER trg_on_campaign_decision
AFTER UPDATE OF approval_status ON public.comm_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.on_campaign_decision();