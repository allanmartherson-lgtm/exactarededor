-- Fix 1: invoices.upload_token — remove column from authenticated SELECT.
-- Workflow UI already fetches tokens via SECURITY DEFINER RPC get_invoice_upload_tokens.
-- Edge functions use service_role and remain unaffected.
REVOKE SELECT (upload_token) ON public.invoices FROM authenticated;
REVOKE SELECT (upload_token) ON public.invoices FROM anon;

-- Fix 2: production_validations.token — same approach.
-- Token is for external (unauthenticated) validation links; portal users access the record via the portal directly.
REVOKE SELECT (token) ON public.production_validations FROM authenticated;
REVOKE SELECT (token) ON public.production_validations FROM anon;

-- Fix 3: financial_journal — block portal users (company/doctor) from reading journal entries.
DROP POLICY IF EXISTS "Authenticated can read journal" ON public.financial_journal;
CREATE POLICY "Authenticated can read journal"
  ON public.financial_journal
  FOR SELECT
  TO authenticated
  USING (NOT public.is_portal_user(auth.uid()));