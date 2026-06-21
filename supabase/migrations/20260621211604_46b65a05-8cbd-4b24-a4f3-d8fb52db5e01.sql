-- ============================================================================
-- find_status_inconsistent_payments
-- ----------------------------------------------------------------------------
-- Para cada lote em modo `padrao`, calcula qual SERIA o `payments.status`
-- aplicando a mesma lógica de `recompute_payment_status_from_groups` e
-- compara com o status atual. Retorna apenas os divergentes.
--
-- Restrições defensivas:
--   * só olha pagamentos em modo `padrao` (confecção tem máquina separada);
--   * só olha pagamentos atualizados nos últimos 14 dias (limita custo);
--   * só olha pagamentos NÃO terminais — `pago/rejeitado/cancelado/arquivado`
--     não devem ser "consertados" por um watchdog;
--   * ignora pagamentos com job de análise em andamento (a recompute manda
--     `em_analise_ia` enquanto há job, gerando ruído falso-positivo).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_status_inconsistent_payments(_limit integer DEFAULT 100)
RETURNS TABLE(
  payment_id uuid,
  current_status public.payment_status,
  expected_status public.payment_status,
  total_groups integer,
  last_updated timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT p.id, p.status, p.updated_at
      FROM public.payments p
     WHERE p.analysis_mode = 'padrao'
       AND p.updated_at > now() - interval '14 days'
       AND p.status NOT IN (
             'pago'::public.payment_status,
             'rejeitado'::public.payment_status,
             'cancelado'::public.payment_status,
             'arquivado'::public.payment_status
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_processing_jobs j
              WHERE j.payment_id = p.id AND j.status = 'em_andamento'
           )
     ORDER BY p.updated_at DESC
     LIMIT GREATEST(_limit, 1) * 4   -- folga para filtrar inconsistentes
  ),
  agg AS (
    SELECT
      c.id AS payment_id,
      c.status AS current_status,
      c.updated_at,
      count(g.*)::int AS total_groups,
      count(*) FILTER (WHERE g.status = 'em_analise_ia')          AS s_em_analise,
      count(*) FILTER (WHERE g.status = 'revisao_analista')       AS s_revisao,
      count(*) FILTER (WHERE g.status = 'concluida_analista')     AS s_concluida,
      count(*) FILTER (WHERE g.status = 'devolvido_analista')     AS s_dev_analista,
      count(*) FILTER (WHERE g.status = 'aguardando_validacao')   AS s_aguard_val,
      count(*) FILTER (WHERE g.status = 'aguardando_aprovacao')   AS s_aguard_apr,
      count(*) FILTER (WHERE g.status = 'aprovado_em_revisao')    AS s_apr_revisao,
      count(*) FILTER (WHERE g.status = 'em_questionamento')      AS s_questionado,
      count(*) FILTER (WHERE g.status = 'revisao_pos_aprovacao')  AS s_rev_pos_apr,
      count(*) FILTER (WHERE g.status = 'pedido_nf_enviado')      AS s_pedido_nf,
      count(*) FILTER (WHERE g.status = 'nf_recebida')            AS s_nf_recebida,
      count(*) FILTER (WHERE g.status = 'nf_conciliada')          AS s_nf_concil,
      count(*) FILTER (WHERE g.status = 'lancado')                AS s_lancado,
      count(*) FILTER (WHERE g.status = 'pago')                   AS s_pago,
      count(*) FILTER (WHERE g.status = 'arquivado')              AS s_arquivado,
      count(*) FILTER (WHERE g.status = 'rejeitado')              AS s_rejeitado,
      count(*) FILTER (WHERE g.status = 'cancelado')              AS s_cancelado
    FROM candidates c
    LEFT JOIN public.payment_company_groups g ON g.payment_id = c.id
    GROUP BY c.id, c.status, c.updated_at
  ),
  expected AS (
    SELECT
      a.payment_id, a.current_status, a.total_groups, a.updated_at,
      CASE
        WHEN a.total_groups = 0 THEN NULL
        WHEN a.s_em_analise > 0    THEN 'em_analise_ia'::public.payment_status
        WHEN a.s_revisao > 0       THEN 'revisao_analista'::public.payment_status
        WHEN a.s_dev_analista > 0  THEN 'devolvido_analista'::public.payment_status
        WHEN a.s_aguard_val > 0 OR a.s_concluida > 0
                                   THEN 'aguardando_validacao'::public.payment_status
        WHEN a.s_aguard_apr > 0 OR a.s_questionado > 0
                                   THEN 'aguardando_aprovacao'::public.payment_status
        WHEN a.s_apr_revisao > 0 OR a.s_rev_pos_apr > 0
                                   THEN 'revisao_pos_aprovacao'::public.payment_status
        WHEN a.s_pedido_nf > 0 OR a.s_nf_recebida > 0
                                   THEN 'pedido_nf_enviado'::public.payment_status
        WHEN a.s_arquivado = a.total_groups
                                   THEN 'arquivado'::public.payment_status
        WHEN a.s_nf_concil > 0 AND (a.s_nf_concil + a.s_lancado + a.s_pago + a.s_rejeitado + a.s_cancelado + a.s_arquivado + a.s_questionado) = a.total_groups
                                   THEN 'nf_conciliada'::public.payment_status
        WHEN a.s_pago = a.total_groups
                                   THEN 'pago'::public.payment_status
        WHEN (a.s_lancado + a.s_pago) > 0 AND (a.s_lancado + a.s_pago + a.s_rejeitado + a.s_cancelado + a.s_arquivado) = a.total_groups
                                   THEN 'lancado'::public.payment_status
        ELSE 'aguardando_aprovacao'::public.payment_status
      END AS expected_status
    FROM agg a
  )
  SELECT e.payment_id, e.current_status, e.expected_status, e.total_groups, e.updated_at
    FROM expected e
   WHERE e.expected_status IS NOT NULL
     AND e.expected_status IS DISTINCT FROM e.current_status
   ORDER BY e.updated_at DESC
   LIMIT GREATEST(_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_status_inconsistent_payments(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_status_inconsistent_payments(integer) TO service_role;

-- ============================================================================
-- repair_status_inconsistencies
-- ----------------------------------------------------------------------------
-- Reaplica recompute_payment_status_from_groups para todos os divergentes
-- detectados e retorna o que mudou — usado pelo watchdog para registrar
-- auditoria.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.repair_status_inconsistencies(_limit integer DEFAULT 50)
RETURNS TABLE(
  payment_id uuid,
  before_status public.payment_status,
  after_status public.payment_status,
  expected_status public.payment_status,
  total_groups integer,
  fixed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_after public.payment_status;
BEGIN
  FOR r IN
    SELECT * FROM public.find_status_inconsistent_payments(_limit)
  LOOP
    BEGIN
      PERFORM public.recompute_payment_status_from_groups(r.payment_id);
    EXCEPTION WHEN OTHERS THEN
      -- não derruba o watchdog se um único pagamento falhar
      RAISE WARNING 'repair_status_inconsistencies: recompute falhou para %: %', r.payment_id, SQLERRM;
      payment_id      := r.payment_id;
      before_status   := r.current_status;
      after_status    := r.current_status;
      expected_status := r.expected_status;
      total_groups    := r.total_groups;
      fixed           := false;
      RETURN NEXT;
      CONTINUE;
    END;

    SELECT status INTO v_after FROM public.payments WHERE id = r.payment_id;

    payment_id      := r.payment_id;
    before_status   := r.current_status;
    after_status    := v_after;
    expected_status := r.expected_status;
    total_groups    := r.total_groups;
    fixed           := (v_after IS DISTINCT FROM r.current_status);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_status_inconsistencies(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_status_inconsistencies(integer) TO service_role;