
ALTER TABLE public.company_threads
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.comm_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_company_threads_campaign_id
  ON public.company_threads(campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.doctor_messages
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.comm_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_messages_campaign_id
  ON public.doctor_messages(campaign_id) WHERE campaign_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_campaign_read(_recipient_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.comm_campaign_recipients
     SET read_at = COALESCE(read_at, now()),
         status  = CASE WHEN status IN ('pending','delivered') THEN 'read' ELSE status END
   WHERE id = _recipient_id
     AND (
       (company_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.company_portal_users
           WHERE auth_user_id = auth.uid()
             AND company_id  = comm_campaign_recipients.company_id))
       OR
       (doctor_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.doctor_portal_users
           WHERE auth_user_id = auth.uid()
             AND doctor_id   = comm_campaign_recipients.doctor_id))
     );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_campaign_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_campaign_read(uuid) TO authenticated;
