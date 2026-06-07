-- RPC: call_supervisor
-- Permite que analista/validador acione o supervisor (diretor + admin) a partir
-- da thread de questionamentos de uma empresa em qualquer etapa (Confecção/Análise).
-- Registra: (1) mensagem na thread (payment_questions), (2) notificações inbox
-- (internal_notifications) para todos os supervisores ativos, (3) observação de
-- auditoria (payment_observations) com a etapa em que o chamado ocorreu.

CREATE OR REPLACE FUNCTION public.call_supervisor(
  p_payment_id uuid,
  p_company_group_id uuid,
  p_stage text,              -- 'confeccao' | 'analise'
  p_note text DEFAULT NULL
)
RETURNS TABLE(question_id uuid, notified_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_author_name text;
  v_hospital_id uuid;
  v_company_name text;
  v_stage_label text;
  v_question_id uuid;
  v_msg text;
  v_notified int := 0;
  v_supervisor record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF p_stage NOT IN ('confeccao', 'analise') THEN
    RAISE EXCEPTION 'invalid stage: %', p_stage;
  END IF;

  -- Caller precisa ter papel operacional (analista/validador/diretor/admin)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND role IN ('analista','validador','diretor','admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: role required';
  END IF;

  SELECT COALESCE(full_name, email, 'Usuário') INTO v_author_name
    FROM public.profiles WHERE id = v_uid;

  SELECT hospital_id INTO v_hospital_id
    FROM public.payments WHERE id = p_payment_id;

  SELECT company_name INTO v_company_name
    FROM public.payment_company_groups WHERE id = p_company_group_id;

  v_stage_label := CASE p_stage WHEN 'confeccao' THEN 'Confecção' ELSE 'Análise' END;
  v_msg := format('[Supervisor acionado · %s] %s', v_stage_label,
                  COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), 'Sem comentário adicional.'));

  -- 1) mensagem na thread da empresa
  INSERT INTO public.payment_questions
    (payment_id, company_group_id, author_id, author_name, message, hospital_id, author_type, status)
  VALUES
    (p_payment_id, p_company_group_id, v_uid, v_author_name, v_msg, v_hospital_id, 'interno', 'pendente')
  RETURNING id INTO v_question_id;

  -- 2) notifica supervisores (diretor + admin) — escopados ao mesmo hospital quando aplicável
  FOR v_supervisor IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      LEFT JOIN public.user_hospitals uh
             ON uh.user_id = ur.user_id
            AND (v_hospital_id IS NULL OR uh.hospital_id = v_hospital_id)
     WHERE ur.role IN ('diretor','admin')
       AND ur.user_id <> v_uid
       AND (v_hospital_id IS NULL OR uh.user_id IS NOT NULL)
  LOOP
    INSERT INTO public.internal_notifications (user_id, kind, title, body, link, payload)
    VALUES (
      v_supervisor.user_id,
      'warning',
      format('Supervisor acionado · %s', v_stage_label),
      format('%s solicitou apoio em %s — etapa %s.',
             v_author_name, COALESCE(v_company_name, 'empresa'), v_stage_label),
      format('/pagamentos/%s/empresa/%s', p_payment_id, p_company_group_id),
      jsonb_build_object(
        'type', 'supervisor_call',
        'stage', p_stage,
        'payment_id', p_payment_id,
        'company_group_id', p_company_group_id,
        'company_name', v_company_name,
        'called_by', v_uid,
        'called_by_name', v_author_name,
        'question_id', v_question_id,
        'note', COALESCE(p_note, '')
      )
    );
    v_notified := v_notified + 1;
  END LOOP;

  -- 3) registra observação de auditoria (histórico do pagamento)
  INSERT INTO public.payment_observations
    (payment_id, author_type, author_id, message, observation_type, hospital_id)
  VALUES
    (p_payment_id,
     'analista'::observation_author,
     v_uid,
     format('Supervisor acionado na etapa %s para %s. Notificados: %s. %s',
            v_stage_label, COALESCE(v_company_name, '—'),
            v_notified::text,
            COALESCE(NULLIF(trim(COALESCE(p_note,'')), ''), '')),
     'informativo'::observation_type,
     v_hospital_id);

  question_id := v_question_id;
  notified_count := v_notified;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.call_supervisor(uuid, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.call_supervisor(uuid, uuid, text, text) FROM anon;