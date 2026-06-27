
-- Tighten company portal SELECT on invoices to also enforce hospital scope
-- via company_portal_user_hospitals when the invoice has a hospital_id.

DROP POLICY IF EXISTS "invoices_view_company_portal" ON public.invoices;

CREATE POLICY "invoices_view_company_portal"
ON public.invoices
FOR SELECT
TO authenticated
USING (
  sent_at IS NOT NULL
  AND status <> 'cancelada'::invoice_status
  AND public.is_company_portal_user(auth.uid(), company_id)
  AND (
    hospital_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.company_portal_user_hospitals cpuh
      JOIN public.company_portal_users cpu ON cpu.id = cpuh.portal_user_id
      WHERE cpu.user_id = auth.uid()
        AND cpu.company_id = invoices.company_id
        AND cpu.active = true
        AND cpuh.hospital_id = invoices.hospital_id
    )
  )
);
