-- =========================================================================
-- Separação Confecção × Análise: novo enum + colunas dedicadas + guards
-- =========================================================================

-- 1) Novo enum de status de confecção
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'confeccao_status') THEN
    CREATE TYPE public.confeccao_status AS ENUM (
      'em_confeccao',
      'confeccao_concluida',
      'cancelada'
    );
  END IF;
END $$;

-- 2) Novas colunas em payments e payment_company_groups
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS confeccao_status public.confeccao_status,
  ADD COLUMN IF NOT EXISTS confeccao_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS confeccao_finalized_by uuid;

ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS confeccao_status public.confeccao_status,
  ADD COLUMN IF NOT EXISTS confeccao_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS confeccao_finalized_by uuid;

CREATE INDEX IF NOT EXISTS idx_payments_confeccao_status
  ON public.payments(confeccao_status) WHERE confeccao_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pcg_confeccao_status
  ON public.payment_company_groups(confeccao_status) WHERE confeccao_status IS NOT NULL;

-- 3) Remover triggers antigos que dependiam de status='em_confeccao'
DROP TRIGGER IF EXISTS trg_block_confeccao_skip_payments ON public.payments;
DROP TRIGGER IF EXISTS trg_block_confeccao_skip_groups ON public.payment_company_groups;

-- 4) Backfill
-- 4a) payment_company_groups: em_confeccao -> confeccao_status, status volta a rascunho
UPDATE public.payment_company_groups
SET confeccao_status = 'em_confeccao',
    status = 'rascunho'
WHERE status = 'em_confeccao';

-- 4b) payments: idem, respeitando guard_payments_status_writes
DO $$
BEGIN
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
  SET confeccao_status = 'em_confeccao',
      status = 'rascunho'
  WHERE status = 'em_confeccao';
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END $$;

-- 5) Trigger de coerência: garante que status (análise) e confeccao_status
--    não se misturem indevidamente.
CREATE OR REPLACE FUNCTION public.enforce_confeccao_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mode public.payment_analysis_mode;
BEGIN
  -- Em payment_company_groups, analysis_mode mora no payment pai
  IF TG_TABLE_NAME = 'payment_company_groups' THEN
    SELECT analysis_mode INTO mode FROM public.payments WHERE id = NEW.payment_id;
  ELSE
    mode := NEW.analysis_mode;
  END IF;

  IF mode = 'confeccao' THEN
    -- Em modo confecção, status (análise) só pode ficar nos placeholders
    IF NEW.status NOT IN ('rascunho','arquivado','cancelado') THEN
      RAISE EXCEPTION
        'Transição inválida em modo CONFECÇÃO: payments.status=% não é permitido. '
        'Use a função finalize_confeccao() para encaminhar à análise.',
        NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- confeccao_status é obrigatório (a menos que esteja cancelado/arquivado)
    IF NEW.confeccao_status IS NULL AND NEW.status NOT IN ('arquivado','cancelado') THEN
      RAISE EXCEPTION
        'Em modo CONFECÇÃO confeccao_status é obrigatório (não pode ser NULL).'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Em modo análise (padrao/isolado/empresa_prioritaria), confeccao_status
    -- pode existir como histórico ('confeccao_concluida'), mas não pode ser
    -- 'em_confeccao' (estado vivo de confecção).
    IF NEW.confeccao_status = 'em_confeccao' THEN
      RAISE EXCEPTION
        'Inconsistência: confeccao_status=em_confeccao só é válido com analysis_mode=confeccao.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_confeccao_coherence_payments ON public.payments;
CREATE TRIGGER trg_confeccao_coherence_payments
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_confeccao_status_coherence();

DROP TRIGGER IF EXISTS trg_confeccao_coherence_groups ON public.payment_company_groups;
CREATE TRIGGER trg_confeccao_coherence_groups
  BEFORE INSERT OR UPDATE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_confeccao_status_coherence();

-- 6) Atualizar recompute_payment_status_from_groups
--    - Para confecção: NÃO mexe em payments.status (fica em rascunho);
--      apenas deriva confeccao_status agregando os grupos.
--    - Para análise: lógica original sem o ramo em_confeccao.
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
  cf_em          integer; cf_concl       integer;
  has_active_job boolean;
  cur_status     public.payment_status;
  new_status     public.payment_status;
  new_cf_status  public.confeccao_status;
BEGIN
  SELECT analysis_mode INTO pay_mode FROM public.payments WHERE id = _payment_id;

  IF pay_mode = 'confeccao' THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE confeccao_status = 'em_confeccao'),
      count(*) FILTER (WHERE confeccao_status = 'confeccao_concluida')
    INTO total_groups, cf_em, cf_concl
    FROM public.payment_company_groups WHERE payment_id = _payment_id;

    IF total_groups = 0 THEN RETURN; END IF;

    IF cf_em > 0 THEN
      new_cf_status := 'em_confeccao';
    ELSIF cf_concl = total_groups THEN
      new_cf_status := 'confeccao_concluida';
    ELSE
      new_cf_status := 'em_confeccao';
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
    count(*) FILTER (WHERE status = 'pago')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado,
       s_em_analise, s_revisao, s_concluida, s_dev_analista,
       s_aguard_val, s_aguard_apr, s_apr_revisao, s_arquivado,
       s_questionado, s_rev_pos_apr, s_pedido_nf, s_nf_recebida,
       s_nf_concil, s_lancado, s_pago
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
  ELSIF s_revisao > 0 OR s_concluida > 0 THEN new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
  ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 OR s_questionado > 0 THEN new_status := 'aguardando_aprovacao';
  ELSIF s_apr_revisao > 0 OR s_rev_pos_apr > 0 THEN new_status := 'revisao_pos_aprovacao';
  ELSIF s_pedido_nf > 0 OR s_nf_recebida > 0 THEN new_status := 'pedido_nf_enviado';
  ELSIF s_arquivado = total_groups THEN new_status := 'arquivado';
  ELSIF s_nf_concil > 0 AND (s_nf_concil + s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado + s_questionado) = total_groups THEN
    new_status := 'nf_conciliada';
  ELSIF (s_lancado + s_pago) > 0 AND (s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado) = total_groups THEN
    new_status := 'lancado';
  ELSIF s_pago = total_groups THEN new_status := 'pago';
  ELSE new_status := 'aguardando_aprovacao';
  END IF;

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;

-- 7) RPC: finalizar confecção e encaminhar o lote inteiro para análise
CREATE OR REPLACE FUNCTION public.finalize_confeccao(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % não encontrado', _payment_id;
  END IF;

  IF pay.analysis_mode IS DISTINCT FROM 'confeccao' THEN
    RAISE EXCEPTION 'Pagamento % não está em modo confecção (mode=%)', _payment_id, pay.analysis_mode;
  END IF;

  -- Marca todos os grupos como concluídos
  UPDATE public.payment_company_groups
  SET confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      updated_at = now()
  WHERE payment_id = _payment_id
    AND (confeccao_status IS NULL OR confeccao_status = 'em_confeccao');

  -- Vira o lote para modo análise. Como o trigger de coerência exige
  -- analysis_mode != 'confeccao' para qualquer status diferente de
  -- rascunho/arquivado/cancelado, atualizamos analysis_mode primeiro
  -- e depois deixamos recompute escolher o status correto.
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
  SET analysis_mode = 'padrao',
      confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      status = 'em_analise_ia',
      updated_at = now()
  WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);

  -- Replica analysis_mode nos grupos e coloca seus status em revisao_analista
  -- (motor de análise vai processar a partir daí). Status placeholder vira
  -- revisao_analista para o analista trabalhar.
  UPDATE public.payment_company_groups
  SET status = 'revisao_analista',
      updated_at = now()
  WHERE payment_id = _payment_id
    AND status IN ('rascunho');

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, payload)
  VALUES ('payment', _payment_id, 'confeccao_finalizada', uid,
          jsonb_build_object('from_mode','confeccao','to_mode','padrao'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_confeccao(uuid) TO authenticated;