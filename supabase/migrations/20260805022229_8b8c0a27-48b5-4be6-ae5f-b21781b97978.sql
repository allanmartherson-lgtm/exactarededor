CREATE OR REPLACE FUNCTION public.sync_agreement_status_from_hospitals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agreement uuid := COALESCE(NEW.agreement_id, OLD.agreement_id);
  v_total int;
  v_aprovados int;
  v_rejeitados int;
  v_com_regra int;
  v_first_reject text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status = 'aprovado'),
         count(*) FILTER (WHERE status = 'rejeitado'),
         count(*) FILTER (WHERE status = 'aprovado' AND linked_rule_id IS NOT NULL)
    INTO v_total, v_aprovados, v_rejeitados, v_com_regra
    FROM public.agreement_registration_hospitals
   WHERE agreement_id = v_agreement;

  IF v_total = 0 THEN
    RETURN NEW;
  END IF;

  IF v_rejeitados > 0 THEN
    SELECT rejection_reason INTO v_first_reject
      FROM public.agreement_registration_hospitals
     WHERE agreement_id = v_agreement AND status = 'rejeitado'
     ORDER BY director_approved_at NULLS LAST
     LIMIT 1;
    UPDATE public.agreement_registrations
       SET status = 'rejeitado',
           rejection_reason = COALESCE(v_first_reject, rejection_reason),
           updated_at = now()
     WHERE id = v_agreement AND status <> 'rejeitado';
  ELSIF v_aprovados = v_total AND v_com_regra = v_total THEN
    UPDATE public.agreement_registrations
       SET status = 'cadastrado',
           analyst_registered_at = COALESCE(analyst_registered_at, now()),
           updated_at = now()
     WHERE id = v_agreement AND status <> 'cadastrado';
  ELSIF v_aprovados = v_total THEN
    UPDATE public.agreement_registrations
       SET status = 'aprovado',
           updated_at = now()
     WHERE id = v_agreement AND status NOT IN ('aprovado', 'cadastrado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agreement_status_from_hospitals ON public.agreement_registration_hospitals;
CREATE TRIGGER trg_sync_agreement_status_from_hospitals
AFTER INSERT OR UPDATE ON public.agreement_registration_hospitals
FOR EACH ROW EXECUTE FUNCTION public.sync_agreement_status_from_hospitals();