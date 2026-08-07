-- Cabeia 'concluido_validacao' no cálculo do status agregado do pagamento.
--
-- Sem essa mudança, um pagamento cujos grupos estão todos em
-- 'concluido_validacao' (hospitais no módulo "validação", via
-- conclude_groups_at_validator) caía no fallback genérico
-- 'aguardando_aprovacao' — errado, porque esses hospitais não têm etapa de
-- diretor. Fica no mesmo degrau de prioridade de aprovado_em_revisao /
-- revisao_pos_aprovacao (mesmo estágio do funil: aprovação humana concluída,
-- prestes a seguir para a fase de NF), mas com rótulo próprio em vez de
-- herdar 'revisao_pos_aprovacao' (que semanticamente é sobre a revisão
-- pós-aprovação do diretor, não se aplica ao módulo validação).
CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pay_mode       public.payment_analysis_mode;
  total_groups   integer;
  s_aprovado     integer; s_rejeitado    integer; s_cancelado    integer;
  s_em_analise   integer; s_revisao      integer; s_concluida    integer;
  s_dev_analista integer; s_aguard_val   integer; s_aguard_apr   integer;
  s_apr_revisao  integer; s_arquivado    integer; s_questionado  integer;
  s_rev_pos_apr  integer; s_pedido_nf    integer; s_nf_recebida  integer;
  s_nf_concil    integer; s_lancado      integer; s_pago         integer;
  s_concl_valid  integer;
  cf_em          integer; cf_concl       integer;
  has_active_job boolean;
  cur_status     public.payment_status;
  new_status     public.payment_status;
  new_cf_status  public.confeccao_status;
BEGIN
  SELECT analysis_mode INTO pay_mode FROM public.payments WHERE id = _payment_id;

  IF pay_mode = 'confeccao' THEN
    SELECT count(*),
           count(*) FILTER (WHERE confeccao_status = 'em_confeccao'),
           count(*) FILTER (WHERE confeccao_status = 'confeccao_concluida')
      INTO total_groups, cf_em, cf_concl
      FROM public.payment_company_groups WHERE payment_id = _payment_id;

    IF total_groups = 0 THEN RETURN; END IF;

    IF cf_em > 0 THEN new_cf_status := 'em_confeccao';
    ELSIF cf_concl = total_groups THEN new_cf_status := 'confeccao_concluida';
    ELSE new_cf_status := 'em_confeccao';
    END IF;

    UPDATE public.payments
       SET confeccao_status = new_cf_status, updated_at = now()
     WHERE id = _payment_id;
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'aprovado'),
    count(*) FILTER (WHERE status = 'rejeitado'),
    count(*) FILTER (WHERE status = 'cancelado'),
    count(*) FILTER (WHERE status = 'em_analise_ia'),
    count(*) FILTER (WHERE status = 'revisao_analista'),
    count(*) FILTER (WHERE status = 'concluida_analista'),
    count(*) FILTER (WHERE status = 'devolvido_analista'),
    count(*) FILTER (WHERE status = 'aguardando_validacao'),
    count(*) FILTER (WHERE status = 'aguardando_aprovacao'),
    count(*) FILTER (WHERE status = 'aprovado_em_revisao'),
    count(*) FILTER (WHERE status = 'arquivado'),
    count(*) FILTER (WHERE status = 'em_questionamento'),
    count(*) FILTER (WHERE status = 'revisao_pos_aprovacao'),
    count(*) FILTER (WHERE status = 'pedido_nf_enviado'),
    count(*) FILTER (WHERE status = 'nf_recebida'),
    count(*) FILTER (WHERE status = 'nf_conciliada'),
    count(*) FILTER (WHERE status = 'lancado'),
    count(*) FILTER (WHERE status = 'pago'),
    count(*) FILTER (WHERE status = 'concluido_validacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado,
       s_em_analise, s_revisao, s_concluida, s_dev_analista,
       s_aguard_val, s_aguard_apr, s_apr_revisao, s_arquivado,
       s_questionado, s_rev_pos_apr, s_pedido_nf, s_nf_recebida,
       s_nf_concil, s_lancado, s_pago, s_concl_valid
  FROM public.payment_company_groups WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN RETURN; END IF;

  SELECT status INTO cur_status FROM public.payments WHERE id = _payment_id;
  SELECT EXISTS (
    SELECT 1 FROM public.payment_processing_jobs
    WHERE payment_id = _payment_id AND status = 'em_andamento'
  ) INTO has_active_job;

  IF has_active_job AND cur_status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista') THEN
    new_status := 'em_analise_ia';
  ELSIF s_em_analise   > 0 THEN new_status := 'em_analise_ia';
  -- FIX: 'concluida_analista' (grupo pronto pelo analista) NÃO trava o lote em revisão.
  -- Só grupos ainda 'revisao_analista' devem manter o lote em revisão.
  ELSIF s_revisao > 0 THEN new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
  -- Grupos concluídos pelo analista contam como aguardando validação.
  ELSIF s_aguard_val > 0 OR s_concluida > 0 THEN new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 OR s_questionado > 0 THEN new_status := 'aguardando_aprovacao';
  ELSIF s_apr_revisao > 0 OR s_rev_pos_apr > 0 THEN new_status := 'revisao_pos_aprovacao';
  ELSIF s_concl_valid > 0 THEN new_status := 'concluido_validacao';
  ELSIF s_pedido_nf > 0 OR s_nf_recebida > 0 THEN new_status := 'pedido_nf_enviado';
  ELSIF s_arquivado = total_groups THEN new_status := 'arquivado';
  ELSIF s_nf_concil > 0 AND (s_nf_concil + s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado + s_questionado) = total_groups THEN
    new_status := 'nf_conciliada';
  ELSIF s_pago = total_groups THEN new_status := 'pago';
  ELSIF (s_lancado + s_pago) > 0 AND (s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado) = total_groups THEN
    new_status := 'lancado';
  ELSE new_status := 'aguardando_aprovacao';
  END IF;

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;

-- Reprocessa pagamentos que podem estar presos no fallback antigo
-- ('aguardando_aprovacao') por terem grupos em 'concluido_validacao' sem
-- nenhum outro grupo em estágio anterior — vítimas do bug corrigido acima.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id
    FROM public.payments p
    JOIN public.payment_company_groups g ON g.payment_id = p.id
    WHERE p.analysis_mode = 'padrao'
      AND p.status = 'aguardando_aprovacao'
      AND g.status = 'concluido_validacao'::public.payment_status
  LOOP
    PERFORM public.recompute_payment_status_from_groups(r.id);
  END LOOP;
END$$;
