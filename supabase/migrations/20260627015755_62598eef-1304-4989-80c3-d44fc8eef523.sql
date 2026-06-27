
-- Restrictive hospital-scoped policy on comm_campaign_recipients
-- Ensures internal users only see recipients of campaigns belonging to their active hospitals.
-- Portal users (empresa/medico) are unaffected because the permissive portal policies still match their own rows,
-- and this restrictive policy allows NULL auth.uid() / portal access paths via hospital_scope_allows on the parent campaign.

CREATE POLICY "comm_campaign_recipients_hospital_scope_restrictive"
ON public.comm_campaign_recipients
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.comm_campaigns c
    WHERE c.id = comm_campaign_recipients.campaign_id
      AND (
        c.hospital_id IS NULL
        OR public.hospital_scope_allows(c.hospital_id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.comm_campaigns c
    WHERE c.id = comm_campaign_recipients.campaign_id
      AND (
        c.hospital_id IS NULL
        OR public.hospital_scope_allows(c.hospital_id)
      )
  )
);
