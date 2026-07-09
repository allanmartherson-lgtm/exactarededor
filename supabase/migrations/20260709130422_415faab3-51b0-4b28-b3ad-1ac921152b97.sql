-- 1) Storage: aceitar hospital_id como primeiro segmento em payment-files/approval-pdfs
-- O cliente (NewPayment, PaymentDetail, CompanyAnalysis) grava com prefixo `${user.id}/...`
-- ou `${payment.id}/...`. O helper hoje resolve apenas via payments.id, portanto qualquer
-- upload feito antes de existir o payment (fluxo de criação de lote) era bloqueado pela RLS.
-- Ampliamos o helper para também aceitar hospital_id direto e user_id (via user_hospitals),
-- mantendo o filtro por escopo de hospital.

CREATE OR REPLACE FUNCTION public.storage_object_hospital_allows(_bucket text, _name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'extensions'
AS $function$
DECLARE
  _first text;
  _id uuid;
  _hid uuid;
BEGIN
  IF _name IS NULL THEN RETURN false; END IF;
  _first := split_part(_name, '/', 1);
  BEGIN
    _id := _first::uuid;
  EXCEPTION WHEN others THEN
    RETURN public.is_global_role(auth.uid());
  END;

  IF _bucket IN ('payment-files', 'approval-pdfs') THEN
    -- Prioridade: payment.id (fluxo padrão pós-criação)
    SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
    -- Fallback 1: hospital.id direto (uploads pré-payment em NewPayment)
    IF _hid IS NULL THEN
      SELECT id INTO _hid FROM public.hospitals WHERE id = _id;
    END IF;
    -- Fallback 2: user.id → resolve pelo hospital ativo do usuário
    -- Cobre uploads legados feitos com `${user.id}/...` (NewPayment, PaymentDetail,
    -- CompanyAnalysis) — libera se o dono do path for o próprio usuário autenticado
    -- e ele tiver acesso a algum hospital.
    IF _hid IS NULL AND _id = auth.uid() THEN
      RETURN EXISTS (SELECT 1 FROM public.user_hospitals WHERE user_id = auth.uid())
             OR public.is_global_role(auth.uid());
    END IF;
  ELSIF _bucket = 'invoices' THEN
    SELECT hospital_id INTO _hid FROM public.invoices WHERE id = _id;
    IF _hid IS NULL THEN
      SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
    END IF;
  ELSIF _bucket = 'reconciliation-files' THEN
    SELECT hospital_id INTO _hid FROM public.reconciliation_runs WHERE id = _id;
  ELSIF _bucket = 'invoice-question-attachments' THEN
    SELECT hospital_id INTO _hid FROM public.invoices WHERE id = _id;
  ELSE
    RETURN false;
  END IF;

  IF _hid IS NULL THEN
    RETURN public.is_global_role(auth.uid());
  END IF;

  RETURN public.hospital_scope_allows(_hid);
END;
$function$;


-- 2) Watchdog de status: ignorar lotes em modo histórico
-- Pagamentos importados no modo `historico` são congelados pelo trigger
-- `trg_payments_historico_guard` em pago/arquivado/cancelado. O watchdog
-- ficava rodando em loop tentando movê-los para `revisao_analista` e falhando
-- 100% das vezes. Filtramos esses registros no finder para evitar ruído
-- e liberar a fila.

CREATE OR REPLACE FUNCTION public.find_status_inconsistent_payments(_limit integer DEFAULT 100)
 RETURNS TABLE(payment_id uuid, current_status payment_status, expected_status payment_status, total_groups integer, last_updated timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT p.id, p.status, p.updated_at
      FROM public.payments p
     WHERE p.analysis_mode IN ('padrao'::public.payment_analysis_mode, 'isolado'::public.payment_analysis_mode, 'empresa_prioritaria'::public.payment_analysis_mode)
       AND COALESCE(p.import_mode, 'normal') <> 'historico'
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
     LIMIT GREATEST(_limit, 1) * 4
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
      a.*,
      CASE
        WHEN a.total_groups = 0 THEN a.current_status
        WHEN a.s_em_analise   > 0 THEN 'em_analise_ia'::public.payment_status
        WHEN a.s_revisao      > 0 THEN 'revisao_analista'::public.payment_status
        WHEN a.s_dev_analista > 0 THEN 'devolvido_analista'::public.payment_status
        WHEN a.s_aguard_val   > 0 OR a.s_concluida > 0 THEN 'aguardando_validacao'::public.payment_status
        WHEN a.s_aguard_apr   > 0 OR a.s_questionado > 0 THEN 'aguardando_aprovacao'::public.payment_status
        WHEN a.s_apr_revisao  > 0 OR a.s_rev_pos_apr > 0 THEN 'revisao_pos_aprovacao'::public.payment_status
        WHEN a.s_pedido_nf    > 0 OR a.s_nf_recebida > 0 THEN 'pedido_nf_enviado'::public.payment_status
        WHEN a.s_arquivado    = a.total_groups THEN 'arquivado'::public.payment_status
        WHEN a.s_nf_concil    > 0 AND (a.s_nf_concil + a.s_lancado + a.s_pago + a.s_rejeitado + a.s_cancelado + a.s_arquivado + a.s_questionado) = a.total_groups THEN 'nf_conciliada'::public.payment_status
        WHEN a.s_pago = a.total_groups THEN 'pago'::public.payment_status
        WHEN (a.s_lancado + a.s_pago) > 0 AND (a.s_lancado + a.s_pago + a.s_rejeitado + a.s_cancelado + a.s_arquivado) = a.total_groups THEN 'lancado'::public.payment_status
        ELSE 'aguardando_aprovacao'::public.payment_status
      END AS expected_status
    FROM agg a
  )
  SELECT e.payment_id, e.current_status, e.expected_status, e.total_groups, e.updated_at
    FROM expected e
   WHERE e.current_status IS DISTINCT FROM e.expected_status
   ORDER BY e.updated_at ASC
   LIMIT _limit;
END;
$function$;