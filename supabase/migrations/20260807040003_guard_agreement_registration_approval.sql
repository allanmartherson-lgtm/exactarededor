-- agreement_registration_hospitals tinha a policy agreement_registration_hospitals_update_flow
-- (FOR UPDATE) liberando analista/gestao_medica a escrever QUALQUER coluna,
-- inclusive status/director_id/director_approved_at, sem nenhum trigger
-- equivalente a guard_group_workflow_transition. Um analista podia fazer
-- UPDATE direto marcando status='aprovado' + director_id arbitrário, e o
-- trigger sync_agreement_status_from_hospitals propagava isso automaticamente
-- para agreement_registrations.status='aprovado'/'cadastrado' — sem nenhuma
-- aprovação real de diretor ter ocorrido.
--
-- Diferente do fluxo de pagamento (que tem um caminho "externo" legítimo com
-- evidência obrigatória), aqui não existe esse mecanismo — a aprovação de
-- acordo é 100% digital, então o bloqueio pode ser incondicional: só
-- diretor/admin aprova ou rejeita, e quem preencheu o acordo não pode
-- aprovar/rejeitar o próprio.
CREATE OR REPLACE FUNCTION public.guard_agreement_hospital_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_filled_by uuid;
BEGIN
  IF public.is_service_role_call() OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.director_id IS DISTINCT FROM OLD.director_id
     AND NEW.director_id IS NOT NULL AND NEW.director_id <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar aprovação de acordo em nome de outro diretor.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('aprovado', 'rejeitado') THEN
    IF NOT public.has_role(v_uid, 'diretor'::public.app_role) THEN
      RAISE EXCEPTION 'Aprovar ou rejeitar acordo exige papel de diretor.' USING ERRCODE = '42501';
    END IF;

    SELECT filled_by INTO v_filled_by
      FROM public.agreement_registrations WHERE id = NEW.agreement_id;
    IF v_filled_by IS NOT NULL AND v_filled_by = v_uid THEN
      RAISE EXCEPTION 'Segregação de funções: quem preencheu o acordo não pode aprová-lo/rejeitá-lo.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_agreement_hospital_approval ON public.agreement_registration_hospitals;
CREATE TRIGGER trg_guard_agreement_hospital_approval
BEFORE UPDATE ON public.agreement_registration_hospitals
FOR EACH ROW EXECUTE FUNCTION public.guard_agreement_hospital_approval();
