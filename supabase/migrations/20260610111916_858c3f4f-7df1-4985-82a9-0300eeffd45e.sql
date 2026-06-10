-- Função de verificação: lista débitos onde total_debt diverge da soma dos itens vinculados.
-- Uso: SELECT * FROM public.glosa_debt_consistency_check();
-- Se retornar qualquer linha, há débito com total_debt fora de sincronia com glosa_debt_items.
CREATE OR REPLACE FUNCTION public.glosa_debt_consistency_check()
RETURNS TABLE (
  debt_id uuid,
  doctor_crm text,
  doctor_name text,
  status text,
  total_debt_stored numeric,
  total_debt_from_items numeric,
  diff numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id,
         d.doctor_crm,
         d.doctor_name,
         d.status,
         COALESCE(d.total_debt, 0)::numeric AS total_debt_stored,
         COALESCE(s.total_items, 0)::numeric AS total_debt_from_items,
         (COALESCE(d.total_debt, 0) - COALESCE(s.total_items, 0))::numeric AS diff
    FROM public.glosa_debts d
    LEFT JOIN (
      SELECT debt_id,
             SUM(GREATEST(amount - COALESCE(applied_amount, 0), 0)) AS total_items
        FROM public.glosa_debt_items
       GROUP BY debt_id
    ) s ON s.debt_id = d.id
   WHERE ROUND(COALESCE(d.total_debt, 0)::numeric, 2)
       <> ROUND(COALESCE(s.total_items, 0)::numeric, 2);
$$;

GRANT EXECUTE ON FUNCTION public.glosa_debt_consistency_check() TO authenticated, service_role;

-- View canônica: total_debt sempre derivado de glosa_debt_items.
-- Painéis devem ler daqui para garantir consistência visual após recompute.
CREATE OR REPLACE VIEW public.v_glosa_debts_balance
WITH (security_invoker = true)
AS
SELECT d.id,
       d.company_id,
       d.doctor_crm,
       d.doctor_name,
       d.status,
       d.resolution_status,
       d.resolution_reason,
       d.parcelas_default,
       d.created_at,
       d.updated_at,
       COALESCE(s.total_items, 0)::numeric AS total_debt,
       COALESCE(d.total_debt, 0)::numeric   AS total_debt_stored
  FROM public.glosa_debts d
  LEFT JOIN (
    SELECT debt_id,
           SUM(GREATEST(amount - COALESCE(applied_amount, 0), 0)) AS total_items
      FROM public.glosa_debt_items
     GROUP BY debt_id
  ) s ON s.debt_id = d.id;

GRANT SELECT ON public.v_glosa_debts_balance TO authenticated, service_role;