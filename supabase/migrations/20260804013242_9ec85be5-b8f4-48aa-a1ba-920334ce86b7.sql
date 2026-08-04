CREATE OR REPLACE FUNCTION public.comm_thread_assign(p_channel text, p_thread_id uuid, p_assignee uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Resolve o hospital dono da thread e exige acesso do chamador.
  -- SECURITY DEFINER ignora RLS: sem isso, admin/diretor de uma unidade
  -- conseguia reatribuir conversa de outro hospital.
  IF p_channel = 'doctor' THEN
    SELECT hospital_id INTO v_hospital FROM public.doctor_messages WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    SELECT hospital_id INTO v_hospital FROM public.payment_questions WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    SELECT hospital_id INTO v_hospital FROM public.invoice_questions WHERE id = p_thread_id;
  ELSE
    RAISE EXCEPTION 'canal inválido: %', p_channel USING ERRCODE = '22023';
  END IF;

  IF v_hospital IS NULL THEN
    RETURN; -- thread inexistente: no-op, sem vazar existência
  END IF;

  PERFORM public.assert_hospital_access(v_hospital);

  IF p_channel = 'doctor' THEN
    UPDATE public.doctor_messages SET assigned_to = p_assignee WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    UPDATE public.payment_questions SET assigned_to = p_assignee WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    UPDATE public.invoice_questions SET assigned_to = p_assignee WHERE id = p_thread_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target_id, metadata)
  VALUES (auth.uid(), 'comm_thread_assign', p_thread_id,
          jsonb_build_object('channel', p_channel, 'assignee', p_assignee));
END;
$function$;

CREATE OR REPLACE FUNCTION public.comm_thread_close(p_channel text, p_thread_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor') OR public.has_role(auth.uid(),'analista')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Mesmo padrão de comm_thread_mark_read: valida escopo de hospital antes de escrever.
  IF p_channel = 'doctor' THEN
    SELECT hospital_id INTO v_hospital FROM public.doctor_messages WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    SELECT hospital_id INTO v_hospital FROM public.payment_questions WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    SELECT hospital_id INTO v_hospital FROM public.invoice_questions WHERE id = p_thread_id;
  ELSE
    RAISE EXCEPTION 'canal inválido: %', p_channel USING ERRCODE = '22023';
  END IF;

  IF v_hospital IS NULL THEN
    RETURN; -- thread inexistente: no-op
  END IF;

  PERFORM public.assert_hospital_access(v_hospital);

  IF p_channel = 'doctor' THEN
    UPDATE public.doctor_messages SET status = 'encerrada' WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    UPDATE public.payment_questions SET status = 'encerrada' WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    UPDATE public.invoice_questions SET status = 'encerrada' WHERE id = p_thread_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target_id, metadata)
  VALUES (auth.uid(), 'comm_thread_close', p_thread_id, jsonb_build_object('channel', p_channel));
END;
$function$;