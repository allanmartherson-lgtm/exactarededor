-- Remove SECURITY DEFINER da view (linter ERROR)
DROP VIEW IF EXISTS public.v_payment_items_registration_issues;
CREATE VIEW public.v_payment_items_registration_issues
WITH (security_invoker = true) AS
SELECT
  pi.id AS item_id,
  pi.payment_id,
  pi.doctor_id,
  pi.doctor_name,
  pi.doctor_document,
  pi.company_id,
  pi.company_name,
  pi.gross_amount,
  pi.created_at,
  (pi.doctor_id IS NULL AND COALESCE(NULLIF(trim(pi.doctor_name), ''), NULLIF(trim(pi.doctor_document), '')) IS NOT NULL) AS doctor_unregistered,
  (
    pi.doctor_id IS NOT NULL
    AND pi.company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.doctor_companies dc
      WHERE dc.doctor_id = pi.doctor_id AND dc.company_id = pi.company_id
    )
  ) AS pj_not_linked_to_doctor
FROM public.payment_items pi;

GRANT SELECT ON public.v_payment_items_registration_issues TO authenticated;
GRANT SELECT ON public.v_payment_items_registration_issues TO service_role;