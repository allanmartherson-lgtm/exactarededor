-- [Sprint 2 - Tier 3.G] Agenda watchdog da análise de pagamentos a cada 2min.
-- Detecta jobs travados (sem update > 90s) e re-dispara próxima página.
-- Jobs idle > 30min são marcados como `parcial`.

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'analysis-watchdog-2min';
EXCEPTION WHEN OTHERS THEN
  -- ignora se nunca existiu
  NULL;
END $$;

SELECT cron.schedule(
  'analysis-watchdog-2min',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bexwvmnwsbltrspmwusp.supabase.co/functions/v1/analysis-watchdog',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJleHd2bW53c2JsdHJzcG13dXNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODU5MDEsImV4cCI6MjA5MzQ2MTkwMX0.4w1JWwd1NsKZvScJIuOHcJubRrWMlScrD1oHj8jBRtQ"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'at', now())
  );
  $cron$
);