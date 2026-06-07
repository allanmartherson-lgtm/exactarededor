CREATE OR REPLACE FUNCTION public.approve_campaign(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'diretor')
     AND NOT public.has_role(auth.uid(), 'validador') THEN
    RAISE EXCEPTION 'Apenas validador, admin ou diretor podem aprovar campanhas';
  END IF;

  UPDATE public.comm_campaigns
     SET approval_status = 'approved',
         approved_by     = auth.uid(),
         approved_at     = now(),
         rejection_reason = NULL
   WHERE id = _campaign_id
     AND approval_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada ou já processada';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_campaign(_campaign_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'diretor')
     AND NOT public.has_role(auth.uid(), 'validador') THEN
    RAISE EXCEPTION 'Apenas validador, admin ou diretor podem rejeitar campanhas';
  END IF;

  UPDATE public.comm_campaigns
     SET approval_status = 'rejected',
         approved_by     = auth.uid(),
         approved_at     = now(),
         rejection_reason = COALESCE(_reason, 'Sem motivo informado')
   WHERE id = _campaign_id
     AND approval_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada ou já processada';
  END IF;
END;
$$;