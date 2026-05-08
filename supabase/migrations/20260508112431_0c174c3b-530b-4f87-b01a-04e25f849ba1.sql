DELETE FROM public.sla_settings WHERE status = 'devolvido_validador';

-- Drop triggers
DROP TRIGGER IF EXISTS payments_detect_status_anomaly ON public.payments;
DROP TRIGGER IF EXISTS payments_guard_status_writes ON public.payments;
DROP TRIGGER IF EXISTS payments_status_history_trg ON public.payments;
DROP TRIGGER IF EXISTS pcg_detect_status_desync ON public.payment_company_groups;
DROP TRIGGER IF EXISTS pcg_recompute_after_change ON public.payment_company_groups;

-- Drop policies que referenciam o tipo
DROP POLICY IF EXISTS items_delete_workflow ON public.payment_items;
DROP POLICY IF EXISTS payments_delete_workflow ON public.payments;

-- Drop funcoes
DROP FUNCTION IF EXISTS public.is_valid_status_transition(public.payment_status, public.payment_status);
DROP FUNCTION IF EXISTS public.record_status_anomaly(uuid, public.payment_status, public.payment_status, text, text, text, jsonb);

-- Recria enum
ALTER TYPE public.payment_status RENAME TO payment_status_old;

CREATE TYPE public.payment_status AS ENUM (
  'rascunho','em_analise_ia','revisao_analista','aguardando_validacao','devolvido_analista',
  'aguardando_aprovacao','aprovado','aprovado_com_ressalva','pedido_nf_enviado','nf_recebida',
  'nf_questionada','nf_divergente','nf_conciliada','lancado','pago','rejeitado','cancelado'
);

ALTER TABLE public.payments
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.payment_status USING status::text::public.payment_status,
  ALTER COLUMN status SET DEFAULT 'rascunho'::public.payment_status;

ALTER TABLE public.payment_company_groups
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.payment_status USING status::text::public.payment_status,
  ALTER COLUMN status SET DEFAULT 'em_analise_ia'::public.payment_status;

ALTER TABLE public.payment_status_history
  ALTER COLUMN status_from TYPE public.payment_status USING status_from::text::public.payment_status,
  ALTER COLUMN status_to TYPE public.payment_status USING status_to::text::public.payment_status;

ALTER TABLE public.payment_observations
  ALTER COLUMN status_from TYPE public.payment_status USING status_from::text::public.payment_status,
  ALTER COLUMN status_to TYPE public.payment_status USING status_to::text::public.payment_status;

ALTER TABLE public.sla_settings
  ALTER COLUMN status TYPE public.payment_status USING status::text::public.payment_status;

ALTER TABLE public.status_anomalies
  ALTER COLUMN status_from TYPE public.payment_status USING status_from::text::public.payment_status,
  ALTER COLUMN status_to TYPE public.payment_status USING status_to::text::public.payment_status;

DROP TYPE public.payment_status_old;

-- Recria policies
CREATE POLICY items_delete_workflow ON public.payment_items FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR (EXISTS (
    SELECT 1 FROM payments p
    WHERE p.id = payment_items.payment_id AND p.created_by = auth.uid()
      AND p.status = ANY (ARRAY['rascunho'::payment_status,'em_analise_ia'::payment_status,'aguardando_validacao'::payment_status,'devolvido_analista'::payment_status,'cancelado'::payment_status])
  ))
);

CREATE POLICY payments_delete_workflow ON public.payments FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR (
    auth.uid() = created_by AND status = ANY (ARRAY['rascunho'::payment_status,'em_analise_ia'::payment_status,'aguardando_validacao'::payment_status,'devolvido_analista'::payment_status,'cancelado'::payment_status])
  )
);

-- Recria is_valid_status_transition
CREATE OR REPLACE FUNCTION public.is_valid_status_transition(_from public.payment_status, _to public.payment_status)
 RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _from IS NULL THEN true
    WHEN _from = _to THEN true
    WHEN _from = 'rascunho' AND _to IN ('em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'em_analise_ia' AND _to IN ('revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'revisao_analista' AND _to IN ('aguardando_validacao','em_analise_ia','cancelado','aguardando_aprovacao') THEN true
    WHEN _from = 'aguardando_validacao' AND _to IN ('aguardando_aprovacao','devolvido_analista','cancelado') THEN true
    WHEN _from = 'devolvido_analista' AND _to IN ('aguardando_validacao','aguardando_aprovacao','em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'aguardando_aprovacao' AND _to IN ('aprovado','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'aprovado' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','aprovado_com_ressalva','cancelado') THEN true
    WHEN _from = 'aprovado_com_ressalva' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','cancelado') THEN true
    WHEN _from = 'pedido_nf_enviado' AND _to IN ('nf_recebida','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_recebida' AND _to IN ('nf_conciliada','nf_divergente','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_questionada' AND _to IN ('nf_recebida','nf_conciliada','nf_divergente','cancelado') THEN true
    WHEN _from = 'nf_divergente' AND _to IN ('nf_conciliada','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_conciliada' AND _to IN ('lancado','pago','cancelado') THEN true
    WHEN _from = 'lancado' AND _to IN ('pago','cancelado') THEN true
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.record_status_anomaly(
  _payment_id uuid, _status_from public.payment_status, _status_to public.payment_status,
  _kind text, _reason text, _severity text DEFAULT 'alta'::text, _context jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _actor uuid := auth.uid();
BEGIN
  INSERT INTO public.status_anomalies(payment_id, status_from, status_to, kind, severity, reason, context, triggered_by)
  VALUES (_payment_id, _status_from, _status_to, _kind, _severity, _reason, _context, _actor)
  RETURNING id INTO _id;
  BEGIN
    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
    VALUES (_actor, 'payment', _payment_id, 'status_anomaly',
      jsonb_build_object('kind', _kind, 'severity', _severity, 'reason', _reason,
        'status_from', _status_from, 'status_to', _status_to, 'context', _context, 'anomaly_id', _id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  total_groups integer; s_aprovado integer; s_rejeitado integer; s_cancelado integer;
  s_em_analise integer; s_revisao integer; s_dev_analista integer;
  s_aguard_val integer; s_aguard_apr integer; new_status public.payment_status;
BEGIN
  SELECT count(*),
    count(*) FILTER (WHERE status='aprovado'), count(*) FILTER (WHERE status='rejeitado'),
    count(*) FILTER (WHERE status='cancelado'), count(*) FILTER (WHERE status='em_analise_ia'),
    count(*) FILTER (WHERE status='revisao_analista'), count(*) FILTER (WHERE status='devolvido_analista'),
    count(*) FILTER (WHERE status='aguardando_validacao'), count(*) FILTER (WHERE status='aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN RETURN; END IF;

  IF s_em_analise > 0 THEN new_status := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
  ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN new_status := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN new_status := 'rejeitado';
    ELSE new_status := 'cancelado'; END IF;
  ELSE new_status := 'aguardando_validacao'; END IF;

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_payment_status_desync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  expected public.payment_status; current_status public.payment_status; total_groups integer;
  s_aprovado integer; s_rejeitado integer; s_cancelado integer;
  s_em_analise integer; s_revisao integer; s_dev_analista integer;
  s_aguard_val integer; s_aguard_apr integer;
  pid uuid := COALESCE(NEW.payment_id, OLD.payment_id);
BEGIN
  IF pid IS NULL THEN RETURN NEW; END IF;
  SELECT count(*),
    count(*) FILTER (WHERE status='aprovado'), count(*) FILTER (WHERE status='rejeitado'),
    count(*) FILTER (WHERE status='cancelado'), count(*) FILTER (WHERE status='em_analise_ia'),
    count(*) FILTER (WHERE status='revisao_analista'), count(*) FILTER (WHERE status='devolvido_analista'),
    count(*) FILTER (WHERE status='aguardando_validacao'), count(*) FILTER (WHERE status='aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups WHERE payment_id = pid;

  IF total_groups = 0 THEN RETURN NEW; END IF;

  IF s_em_analise > 0 THEN expected := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN expected := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN expected := 'devolvido_analista';
  ELSIF s_aguard_val > 0 THEN expected := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN expected := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN expected := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN expected := 'rejeitado';
    ELSE expected := 'cancelado'; END IF;
  ELSE expected := 'aguardando_validacao'; END IF;

  SELECT status INTO current_status FROM public.payments WHERE id = pid;
  IF current_status IS DISTINCT FROM expected THEN
    PERFORM public.record_status_anomaly(pid, current_status, expected, 'out_of_sync',
      format('Status do pagamento (%s) está fora de sincronia com o calculado pelos grupos (%s).', current_status, expected),
      'critica',
      jsonb_build_object('totals', jsonb_build_object('total', total_groups,
        'aprovado', s_aprovado, 'rejeitado', s_rejeitado, 'cancelado', s_cancelado,
        'em_analise_ia', s_em_analise, 'revisao_analista', s_revisao,
        'devolvido_analista', s_dev_analista,
        'aguardando_validacao', s_aguard_val, 'aguardando_aprovacao', s_aguard_apr)));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER payments_status_history_trg
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_payment_status_change();

CREATE TRIGGER payments_guard_status_writes
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payments_status_writes();

CREATE TRIGGER payments_detect_status_anomaly
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.detect_payment_status_anomaly();

CREATE TRIGGER pcg_recompute_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_payment_status();

CREATE TRIGGER pcg_detect_status_desync
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.detect_payment_status_desync();