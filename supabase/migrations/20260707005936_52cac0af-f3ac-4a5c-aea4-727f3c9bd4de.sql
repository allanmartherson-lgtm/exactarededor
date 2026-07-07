-- 1) Coluna de contexto do piso (auditoria inline)
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS piso_context jsonb;

COMMENT ON COLUMN public.payment_items.piso_context IS
  'Trilha de auditoria do piso: {regra_valor, convenio_valor, piso_valor, escopo, applied_at, rule_id}. Preenchido pelo motor sempre que houver piso configurado.';

-- 2) View de recorrência do piso — quantos itens por regra/mês tiveram piso vencedor
CREATE OR REPLACE VIEW public.v_piso_recorrencia AS
SELECT
  pi.hospital_id,
  pi.applied_rule_id                                            AS rule_id,
  date_trunc('month', COALESCE(pi.procedure_date, pi.created_at))::date AS competencia,
  COUNT(*) FILTER (WHERE pi.piso_metodo_vencedor IS NOT NULL)   AS items_com_piso,
  COUNT(*) FILTER (WHERE pi.piso_metodo_vencedor = 'piso')      AS items_piso_aplicado,
  COALESCE(SUM(pi.piso_aplicado_valor)
           FILTER (WHERE pi.piso_metodo_vencedor = 'piso'), 0)  AS total_complementado,
  CASE
    WHEN COUNT(*) FILTER (WHERE pi.piso_metodo_vencedor IS NOT NULL) = 0 THEN 0
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE pi.piso_metodo_vencedor = 'piso')
           / COUNT(*) FILTER (WHERE pi.piso_metodo_vencedor IS NOT NULL),
      1
    )
  END                                                           AS pct_piso_aplicado
FROM public.payment_items pi
WHERE pi.applied_rule_id IS NOT NULL
  AND pi.piso_metodo_vencedor IS NOT NULL
GROUP BY pi.hospital_id, pi.applied_rule_id,
         date_trunc('month', COALESCE(pi.procedure_date, pi.created_at))::date;

GRANT SELECT ON public.v_piso_recorrencia TO authenticated;
GRANT SELECT ON public.v_piso_recorrencia TO service_role;