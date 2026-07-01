
-- 1) Helper: só retorna true se o usuário logado for portal user ativo.
CREATE OR REPLACE FUNCTION public.is_company_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.company_portal_users cpu
    WHERE cpu.user_id = auth.uid() AND cpu.active
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_company_portal_user() TO authenticated, anon, service_role;

-- 2) Reescreve a policy do portal para curto-circuitar por usuário.
DROP POLICY IF EXISTS "empresa lê seus payment_items via invoice liberada" ON public.payment_items;

CREATE POLICY "empresa lê seus payment_items via invoice liberada"
ON public.payment_items
FOR SELECT
TO authenticated
USING (
  public.is_company_portal_user()
  AND EXISTS (
    SELECT 1
    FROM public.invoices i
    JOIN public.company_portal_users cpu ON cpu.company_id = i.company_id
    WHERE i.payment_id = payment_items.payment_id
      AND i.company_id = payment_items.company_id
      AND i.sent_at IS NOT NULL
      AND i.status <> 'cancelada'::invoice_status
      AND cpu.user_id = auth.uid()
      AND cpu.active
  )
);

-- 3) Índice composto para paginação ordenada por created_at dentro de um payment.
CREATE INDEX IF NOT EXISTS idx_payment_items_payment_created
  ON public.payment_items (payment_id, created_at);
