
-- 1) Tabela de anomalias
CREATE TABLE IF NOT EXISTS public.status_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  status_from public.payment_status,
  status_to public.payment_status,
  kind text NOT NULL,                 -- 'invalid_transition' | 'out_of_sync'
  severity text NOT NULL DEFAULT 'alta',  -- baixa | media | alta | critica
  reason text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid,                  -- auth.uid() no momento do incidente
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS status_anomalies_payment_idx
  ON public.status_anomalies (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_anomalies_open_idx
  ON public.status_anomalies (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.status_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anom_view_admin_diretor" ON public.status_anomalies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

CREATE POLICY "anom_update_admin_diretor" ON public.status_anomalies
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

CREATE POLICY "anom_delete_admin" ON public.status_anomalies
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- INSERT é feito por trigger SECURITY DEFINER; nenhuma policy de insert direta.

-- 2) Função: registra anomalia + espelha em audit_log
CREATE OR REPLACE FUNCTION public.record_status_anomaly(
  _payment_id uuid,
  _status_from public.payment_status,
  _status_to public.payment_status,
  _kind text,
  _reason text,
  _severity text DEFAULT 'alta',
  _context jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _actor uuid := auth.uid();
BEGIN
  INSERT INTO public.status_anomalies(
    payment_id, status_from, status_to, kind, severity, reason, context, triggered_by
  ) VALUES (
    _payment_id, _status_from, _status_to, _kind, _severity, _reason, _context, _actor
  ) RETURNING id INTO _id;

  -- Espelha no audit_log para aparecer no histórico geral.
  -- audit_log.actor_id é NULLABLE; sem actor (mudança automática), gravamos NULL.
  BEGIN
    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
    VALUES (
      _actor, 'payment', _payment_id, 'status_anomaly',
      jsonb_build_object(
        'kind', _kind,
        'severity', _severity,
        'reason', _reason,
        'status_from', _status_from,
        'status_to', _status_to,
        'context', _context,
        'anomaly_id', _id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Não bloqueia o registro da anomalia se audit_log falhar.
    NULL;
  END;

  RETURN _id;
END;
$$;

-- 3) Conjunto autoritativo de transições válidas
-- (espelha src/lib/paymentFlow.ts + transições administrativas comuns).
CREATE OR REPLACE FUNCTION public.is_valid_status_transition(
  _from public.payment_status,
  _to public.payment_status
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _from IS NULL THEN true                                  -- INSERT
    WHEN _from = _to THEN true                                    -- noop
    WHEN _from = 'rascunho' AND _to IN ('em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'em_analise_ia' AND _to IN ('revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'revisao_analista' AND _to IN ('aguardando_validacao','em_analise_ia','cancelado','aguardando_aprovacao') THEN true
    WHEN _from = 'aguardando_validacao' AND _to IN ('aguardando_aprovacao','devolvido_analista','cancelado') THEN true
    WHEN _from = 'devolvido_analista' AND _to IN ('aguardando_validacao','aguardando_aprovacao','em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'devolvido_validador' AND _to IN ('aguardando_validacao','revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'aguardando_aprovacao' AND _to IN ('aprovado','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'aprovado' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','aprovado_com_ressalva','cancelado') THEN true
    WHEN _from = 'aprovado_com_ressalva' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','cancelado') THEN true
    WHEN _from = 'pedido_nf_enviado' AND _to IN ('nf_recebida','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_recebida' AND _to IN ('nf_conciliada','nf_divergente','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_questionada' AND _to IN ('nf_recebida','nf_conciliada','nf_divergente','cancelado') THEN true
    WHEN _from = 'nf_divergente' AND _to IN ('nf_conciliada','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_conciliada' AND _to IN ('pago','cancelado') THEN true
    -- Estados terminais não devem reabrir; qualquer saída é anomalia.
    ELSE false
  END;
$$;

-- 4) Trigger: detecta transições inválidas em payments
CREATE OR REPLACE FUNCTION public.detect_payment_status_anomaly()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.is_valid_status_transition(OLD.status, NEW.status) THEN
      PERFORM public.record_status_anomaly(
        NEW.id,
        OLD.status,
        NEW.status,
        'invalid_transition',
        format('Transição de status fora do fluxo permitido: %s → %s', OLD.status, NEW.status),
        CASE
          WHEN OLD.status IN ('aguardando_validacao','aguardando_aprovacao','aprovado','pago')
               AND NEW.status IN ('revisao_analista','em_analise_ia') THEN 'critica'
          ELSE 'alta'
        END,
        jsonb_build_object('reference', NEW.reference)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_detect_status_anomaly ON public.payments;
CREATE TRIGGER payments_detect_status_anomaly
AFTER UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.detect_payment_status_anomaly();

-- 5) Trigger: detecta dessincronia entre payments.status e o calculado dos grupos
CREATE OR REPLACE FUNCTION public.detect_payment_status_desync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  expected public.payment_status;
  current_status public.payment_status;
  total_groups integer;
  s_aprovado integer; s_rejeitado integer; s_cancelado integer;
  s_em_analise integer; s_revisao integer; s_dev_analista integer;
  s_dev_validador integer; s_aguard_val integer; s_aguard_apr integer;
  pid uuid := COALESCE(NEW.payment_id, OLD.payment_id);
BEGIN
  IF pid IS NULL THEN RETURN NEW; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status='aprovado'),
    count(*) FILTER (WHERE status='rejeitado'),
    count(*) FILTER (WHERE status='cancelado'),
    count(*) FILTER (WHERE status='em_analise_ia'),
    count(*) FILTER (WHERE status='revisao_analista'),
    count(*) FILTER (WHERE status='devolvido_analista'),
    count(*) FILTER (WHERE status='devolvido_validador'),
    count(*) FILTER (WHERE status='aguardando_validacao'),
    count(*) FILTER (WHERE status='aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_dev_validador, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups WHERE payment_id = pid;

  IF total_groups = 0 THEN RETURN NEW; END IF;

  IF s_em_analise > 0 THEN expected := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN expected := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN expected := 'devolvido_analista';
  ELSIF s_dev_validador > 0 THEN expected := 'devolvido_validador';
  ELSIF s_aguard_val > 0 THEN expected := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN expected := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN expected := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN expected := 'rejeitado';
    ELSE expected := 'cancelado';
    END IF;
  ELSE
    expected := 'aguardando_validacao';
  END IF;

  SELECT status INTO current_status FROM public.payments WHERE id = pid;

  IF current_status IS DISTINCT FROM expected THEN
    PERFORM public.record_status_anomaly(
      pid, current_status, expected,
      'out_of_sync',
      format('Status do pagamento (%s) está fora de sincronia com o calculado pelos grupos (%s).', current_status, expected),
      'critica',
      jsonb_build_object(
        'totals', jsonb_build_object(
          'total', total_groups,
          'aprovado', s_aprovado, 'rejeitado', s_rejeitado, 'cancelado', s_cancelado,
          'em_analise_ia', s_em_analise, 'revisao_analista', s_revisao,
          'devolvido_analista', s_dev_analista, 'devolvido_validador', s_dev_validador,
          'aguardando_validacao', s_aguard_val, 'aguardando_aprovacao', s_aguard_apr
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pcg_detect_status_desync ON public.payment_company_groups;
CREATE TRIGGER pcg_detect_status_desync
AFTER INSERT OR UPDATE OR DELETE ON public.payment_company_groups
FOR EACH ROW
EXECUTE FUNCTION public.detect_payment_status_desync();
