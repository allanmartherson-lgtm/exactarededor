
-- 1) invoices.upload_token: revoke column-level SELECT from authenticated/anon.
--    Workflow UI reads via SECURITY DEFINER RPC get_invoice_upload_tokens (already in place).
--    Edge functions use service_role.
REVOKE SELECT (upload_token) ON public.invoices FROM authenticated;
REVOKE SELECT (upload_token) ON public.invoices FROM anon;
GRANT SELECT (upload_token) ON public.invoices TO service_role;

-- 2) production_validations.token: same treatment.
REVOKE SELECT (token) ON public.production_validations FROM authenticated;
REVOKE SELECT (token) ON public.production_validations FROM anon;
GRANT SELECT (token) ON public.production_validations TO service_role;

-- 3) comm_campaign_recipients.phone_snapshot / email_snapshot:
--    Portal users SELECT their own recipient rows but the snapshot columns may carry
--    PII of other recipients in the same campaign. Frontend never reads these columns;
--    only the dispatch-broadcast edge function (service_role) writes/reads them.
REVOKE SELECT (phone_snapshot, email_snapshot) ON public.comm_campaign_recipients FROM authenticated;
REVOKE SELECT (phone_snapshot, email_snapshot) ON public.comm_campaign_recipients FROM anon;
GRANT  SELECT (phone_snapshot, email_snapshot) ON public.comm_campaign_recipients TO service_role;

-- 4) hospital_switch_log: drop the redundant "user sees own switch log" policy.
--    No frontend uses it (HospitalSwitchLog page is admin/diretor only) and removing
--    it eliminates the user_email read path flagged by the scanner. Director audit
--    access is intentional and preserved by "admin sees all switch log".
DROP POLICY IF EXISTS "user sees own switch log" ON public.hospital_switch_log;
