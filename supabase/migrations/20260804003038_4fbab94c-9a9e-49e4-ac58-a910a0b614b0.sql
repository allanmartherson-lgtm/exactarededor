CREATE OR REPLACE FUNCTION public.comm_thread_mark_read(
  p_channel text, p_thread_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hospital uuid;
BEGIN
  -- Resolve o hospital dono da thread e exige acesso do chamador.
  -- Sem isso, qualquer usuário autenticado podia marcar como lida a
  -- conversa de outro hospital (a função é SECURITY DEFINER e ignora RLS).
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
    UPDATE public.doctor_messages SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    UPDATE public.payment_questions SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    UPDATE public.invoice_questions SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  END IF;
END;
$$;