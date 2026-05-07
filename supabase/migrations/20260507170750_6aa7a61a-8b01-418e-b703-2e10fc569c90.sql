
-- Proteção: payments.status só pode ser alterado pela função autoritativa
-- public.recompute_payment_status_from_groups (derivado de payment_company_groups).
-- Qualquer outra escrita (edge function, app, query manual) será bloqueada.
--
-- Mecanismo: a função autoritativa define um GUC local
-- (app.allow_payment_status_write = 'on') antes do UPDATE. O trigger BEFORE
-- UPDATE em payments verifica esse GUC; se não estiver presente e o status
-- mudou, levanta exceção.

-- 1) Atualiza a função autoritativa para setar o GUC local antes de escrever.
CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_groups integer;
  s_aprovado integer;
  s_rejeitado integer;
  s_cancelado integer;
  s_em_analise integer;
  s_revisao integer;
  s_dev_analista integer;
  s_dev_validador integer;
  s_aguard_val integer;
  s_aguard_apr integer;
  new_status public.payment_status;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'aprovado'),
    count(*) FILTER (WHERE status = 'rejeitado'),
    count(*) FILTER (WHERE status = 'cancelado'),
    count(*) FILTER (WHERE status = 'em_analise_ia'),
    count(*) FILTER (WHERE status = 'revisao_analista'),
    count(*) FILTER (WHERE status = 'devolvido_analista'),
    count(*) FILTER (WHERE status = 'devolvido_validador'),
    count(*) FILTER (WHERE status = 'aguardando_validacao'),
    count(*) FILTER (WHERE status = 'aguardando_aprovacao')
  INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
       s_dev_analista, s_dev_validador, s_aguard_val, s_aguard_apr
  FROM public.payment_company_groups
  WHERE payment_id = _payment_id;

  IF total_groups = 0 THEN
    RETURN;
  END IF;

  IF s_em_analise > 0 THEN
    new_status := 'em_analise_ia';
  ELSIF s_revisao > 0 THEN
    new_status := 'revisao_analista';
  ELSIF s_dev_analista > 0 THEN
    new_status := 'devolvido_analista';
  ELSIF s_dev_validador > 0 THEN
    new_status := 'devolvido_validador';
  ELSIF s_aguard_val > 0 THEN
    new_status := 'aguardando_validacao';
  ELSIF s_aguard_apr > 0 THEN
    new_status := 'aguardando_aprovacao';
  ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
    IF s_aprovado > 0 THEN
      new_status := 'aprovado';
    ELSIF s_rejeitado = total_groups THEN
      new_status := 'rejeitado';
    ELSE
      new_status := 'cancelado';
    END IF;
  ELSE
    new_status := 'aguardando_validacao';
  END IF;

  -- Libera a escrita de status para esta transação apenas (GUC local).
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
     SET status = new_status, updated_at = now()
   WHERE id = _payment_id;
  -- Volta a bloquear (defensivo).
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
END;
$function$;

-- 2) Trigger BEFORE UPDATE: bloqueia qualquer mudança em status que não venha
--    da função autoritativa. INSERT continua livre (status default ou explícito
--    no momento da criação do lote).
CREATE OR REPLACE FUNCTION public.guard_payments_status_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allow text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    allow := current_setting('app.allow_payment_status_write', true);
    IF allow IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'payments.status só pode ser alterado por recompute_payment_status_from_groups (derivado de payment_company_groups). Tentativa bloqueada: % -> %',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_guard_status_writes ON public.payments;
CREATE TRIGGER payments_guard_status_writes
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_payments_status_writes();
