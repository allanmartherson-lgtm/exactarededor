-- Re-run with correct sla_settings columns
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
    WHEN _from = 'aguardando_aprovacao' AND _to IN ('aprovado','aprovado_em_revisao','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'aprovado_em_revisao' AND _to IN ('pedido_nf_enviado','aprovado','cancelado') THEN true
    WHEN _from = 'aprovado' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','aprovado_com_ressalva','cancelado') THEN true
    WHEN _from = 'aprovado_com_ressalva' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','cancelado') THEN true
    WHEN _from = 'pedido_nf_enviado' AND _to IN ('nf_recebida','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_recebida' AND _to IN ('nf_conciliada','nf_divergente','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_questionada' AND _to IN ('nf_recebida','nf_conciliada','nf_divergente','cancelado') THEN true
    WHEN _from = 'nf_divergente' AND _to IN ('nf_conciliada','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_conciliada' AND _to IN ('lancado','pago','cancelado') THEN true
    WHEN _from = 'lancado' AND _to IN ('arquivado','pago','cancelado') THEN true
    WHEN _from = 'pago' AND _to = 'arquivado' THEN true
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
 DECLARE
   total_groups integer; s_aprovado integer; s_rejeitado integer; s_cancelado integer;
   s_em_analise integer; s_revisao integer; s_dev_analista integer;
   s_aguard_val integer; s_aguard_apr integer; s_apr_revisao integer;
   s_arquivado integer;
   new_status public.payment_status;
 BEGIN
   SELECT count(*),
     count(*) FILTER (WHERE status='aprovado'), count(*) FILTER (WHERE status='rejeitado'),
     count(*) FILTER (WHERE status='cancelado'), count(*) FILTER (WHERE status='em_analise_ia'),
     count(*) FILTER (WHERE status='revisao_analista'), count(*) FILTER (WHERE status='devolvido_analista'),
     count(*) FILTER (WHERE status='aguardando_validacao'), count(*) FILTER (WHERE status='aguardando_aprovacao'),
     count(*) FILTER (WHERE status='aprovado_em_revisao'),
     count(*) FILTER (WHERE status='arquivado')
   INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
        s_dev_analista, s_aguard_val, s_aguard_apr, s_apr_revisao, s_arquivado
   FROM public.payment_company_groups WHERE payment_id = _payment_id;

   IF total_groups = 0 THEN RETURN; END IF;

   IF s_em_analise > 0 THEN new_status := 'em_analise_ia';
   ELSIF s_revisao > 0 THEN new_status := 'revisao_analista';
   ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
   ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
   ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
   ELSIF s_apr_revisao > 0 THEN new_status := 'aprovado_em_revisao';
   ELSIF s_arquivado = total_groups THEN new_status := 'arquivado';
   ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
     IF s_aprovado > 0 THEN new_status := 'aprovado';
     ELSIF s_rejeitado = total_groups THEN new_status := 'rejeitado';
     ELSE new_status := 'cancelado'; END IF;
   ELSE
     IF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
     ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
     ELSIF s_apr_revisao > 0 THEN new_status := 'aprovado_em_revisao';
     ELSE new_status := 'aguardando_validacao';
     END IF;
   END IF;

   PERFORM set_config('app.allow_payment_status_write', 'on', true);
   UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
   PERFORM set_config('app.allow_payment_status_write', 'off', true);
 END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_archived_immutable()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'arquivado' THEN
    RAISE EXCEPTION 'Lote arquivado é imutável (somente leitura). Alteração bloqueada.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'arquivado' THEN
    RAISE EXCEPTION 'Lote arquivado não pode ser excluído.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS pcg_guard_archived ON public.payment_company_groups;
CREATE TRIGGER pcg_guard_archived
  BEFORE UPDATE OR DELETE ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_immutable();

CREATE OR REPLACE FUNCTION public.guard_no_writes_on_archived_payment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE st public.payment_status;
BEGIN
  SELECT status INTO st FROM public.payments WHERE id = NEW.payment_id;
  IF st = 'arquivado' THEN
    RAISE EXCEPTION 'Lote arquivado é somente leitura. Operação bloqueada.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS obs_block_archived ON public.payment_observations;
CREATE TRIGGER obs_block_archived
  BEFORE INSERT OR UPDATE ON public.payment_observations
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_writes_on_archived_payment();

DROP TRIGGER IF EXISTS iq_block_archived ON public.invoice_questions;
CREATE TRIGGER iq_block_archived
  BEFORE INSERT OR UPDATE ON public.invoice_questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_writes_on_archived_payment();

INSERT INTO public.sla_settings (status, active, business_days, warning_pct, severity)
VALUES ('arquivado', false, 0, 80, 'informativo')
ON CONFLICT (status) DO NOTHING;