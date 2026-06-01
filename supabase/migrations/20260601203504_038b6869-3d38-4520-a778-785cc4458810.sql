
-- ============================================
-- Comunicação: padronização threads + SLA
-- ============================================

-- 1) payment_questions: campos de governança
ALTER TABLE public.payment_questions
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.payment_questions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sla_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS author_type text NOT NULL DEFAULT 'interno';

ALTER TABLE public.payment_questions
  DROP CONSTRAINT IF EXISTS payment_questions_status_check;
ALTER TABLE public.payment_questions
  ADD CONSTRAINT payment_questions_status_check
  CHECK (status IN ('pendente','respondida','encerrada'));

ALTER TABLE public.payment_questions
  DROP CONSTRAINT IF EXISTS payment_questions_author_type_check;
ALTER TABLE public.payment_questions
  ADD CONSTRAINT payment_questions_author_type_check
  CHECK (author_type IN ('interno','empresa'));

-- 2) doctor_messages: campos de governança (já tem read_at, responded_at)
ALTER TABLE public.doctor_messages
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS sla_alerted_at timestamptz;

ALTER TABLE public.doctor_messages
  DROP CONSTRAINT IF EXISTS doctor_messages_status_check;
ALTER TABLE public.doctor_messages
  ADD CONSTRAINT doctor_messages_status_check
  CHECK (status IN ('pendente','respondida','encerrada'));

-- 3) invoice_questions: campos de governança (já tem read_at, answered_at)
ALTER TABLE public.invoice_questions
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS sla_alerted_at timestamptz;

ALTER TABLE public.invoice_questions
  DROP CONSTRAINT IF EXISTS invoice_questions_status_check;
ALTER TABLE public.invoice_questions
  ADD CONSTRAINT invoice_questions_status_check
  CHECK (status IN ('pendente','respondida','encerrada'));

-- 4) Tabela de SLA de comunicação
CREATE TABLE IF NOT EXISTS public.communication_sla_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  severity text NOT NULL DEFAULT 'alerta',
  first_response_hours numeric NOT NULL DEFAULT 4,
  resolution_hours numeric NOT NULL DEFAULT 24,
  warning_pct numeric NOT NULL DEFAULT 80,
  active boolean NOT NULL DEFAULT true,
  hospital_id uuid REFERENCES public.hospitals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comm_sla_channel_check CHECK (channel IN ('doctor','company_payment','company_invoice')),
  CONSTRAINT comm_sla_severity_check CHECK (severity IN ('informativo','alerta','critico')),
  UNIQUE (channel, hospital_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_sla_settings TO authenticated;
GRANT ALL ON public.communication_sla_settings TO service_role;

ALTER TABLE public.communication_sla_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_sla_select_authenticated"
ON public.communication_sla_settings FOR SELECT
TO authenticated USING (true);

CREATE POLICY "comm_sla_admin_write"
ON public.communication_sla_settings FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seeds padrão (globais — hospital_id null)
INSERT INTO public.communication_sla_settings (channel, first_response_hours, resolution_hours)
VALUES ('doctor', 4, 24), ('company_payment', 4, 24), ('company_invoice', 4, 24)
ON CONFLICT (channel, hospital_id) DO NOTHING;

-- 5) Trigger: ao inserir mensagem, atualiza thread pai (status, first_response_at)
CREATE OR REPLACE FUNCTION public.payment_questions_update_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_root_id uuid;
BEGIN
  v_root_id := COALESCE(NEW.parent_id, NEW.id);
  IF NEW.author_type = 'interno' THEN
    -- resposta da equipe → marca respondida + first_response_at na raiz
    UPDATE public.payment_questions
       SET status = 'respondida',
           answered_at = COALESCE(answered_at, NEW.created_at),
           first_response_at = COALESCE(first_response_at, NEW.created_at)
     WHERE id = v_root_id AND status <> 'encerrada';
  ELSE
    -- empresa enviou (nova ou réplica) → reabre como pendente
    UPDATE public.payment_questions
       SET status = 'pendente'
     WHERE id = v_root_id AND status <> 'encerrada';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_questions_status ON public.payment_questions;
CREATE TRIGGER trg_payment_questions_status
AFTER INSERT ON public.payment_questions
FOR EACH ROW EXECUTE FUNCTION public.payment_questions_update_status();

-- 6) View unificada
CREATE OR REPLACE VIEW public.communication_threads_v
WITH (security_invoker = on) AS
-- Médico
SELECT
  'doctor'::text AS channel,
  dm.id AS thread_id,
  dm.doctor_id::text AS subject_ref,
  dm.hospital_id,
  dm.assigned_to,
  dm.status,
  dm.created_at AS opened_at,
  dm.created_at AS last_message_at,
  CASE WHEN dm.author_type = 'medico' THEN 'externo' ELSE 'interno' END AS last_author_type,
  dm.first_response_at,
  dm.read_at,
  dm.responded_at AS answered_at,
  dm.sla_alerted_at,
  dm.author_name,
  LEFT(dm.message, 200) AS preview,
  dm.payment_id
FROM public.doctor_messages dm
WHERE dm.thread_id IS NULL OR dm.thread_id = dm.id

UNION ALL

-- Empresa / lote
SELECT
  'company_payment'::text,
  pq.id,
  pq.company_group_id::text,
  pq.hospital_id,
  pq.assigned_to,
  pq.status,
  pq.created_at,
  pq.created_at,
  pq.author_type,
  pq.first_response_at,
  pq.read_at,
  pq.answered_at,
  pq.sla_alerted_at,
  pq.author_name,
  LEFT(pq.message, 200),
  pq.payment_id
FROM public.payment_questions pq
WHERE pq.parent_id IS NULL

UNION ALL

-- Empresa / NF
SELECT
  'company_invoice'::text,
  iq.id,
  iq.invoice_id::text,
  iq.hospital_id,
  iq.assigned_to,
  iq.status,
  iq.created_at,
  iq.created_at,
  CASE WHEN iq.author_type = 'recebedor' THEN 'externo' ELSE 'interno' END,
  iq.first_response_at,
  iq.read_at,
  iq.answered_at,
  iq.sla_alerted_at,
  iq.author_name,
  LEFT(iq.message, 200),
  iq.payment_id
FROM public.invoice_questions iq;

GRANT SELECT ON public.communication_threads_v TO authenticated;

-- 7) RPC: ações do supervisor
CREATE OR REPLACE FUNCTION public.comm_thread_assign(
  p_channel text, p_thread_id uuid, p_assignee uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.comm_thread_close(
  p_channel text, p_thread_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor') OR public.has_role(auth.uid(),'analista')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.comm_thread_mark_read(
  p_channel text, p_thread_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_channel = 'doctor' THEN
    UPDATE public.doctor_messages SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  ELSIF p_channel = 'company_payment' THEN
    UPDATE public.payment_questions SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  ELSIF p_channel = 'company_invoice' THEN
    UPDATE public.invoice_questions SET read_at = COALESCE(read_at, now()) WHERE id = p_thread_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.comm_thread_assign(text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comm_thread_close(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comm_thread_mark_read(text,uuid) TO authenticated;

-- 8) RPC: responder em nome do analista
CREATE OR REPLACE FUNCTION public.comm_reply_on_behalf(
  p_channel text,
  p_thread_id uuid,
  p_message text,
  p_on_behalf_of uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_id uuid;
  v_sup_name text;
  v_target_name text;
  v_author_name text;
  v_parent record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_sup_name FROM public.profiles WHERE id = auth.uid();
  SELECT COALESCE(full_name, email) INTO v_target_name FROM public.profiles WHERE id = p_on_behalf_of;
  v_author_name := COALESCE(v_sup_name,'Supervisor') ||
                   CASE WHEN v_target_name IS NOT NULL THEN ' (em nome de ' || v_target_name || ')' ELSE '' END;

  IF p_channel = 'company_payment' THEN
    SELECT payment_id, company_group_id, hospital_id INTO v_parent
      FROM public.payment_questions WHERE id = p_thread_id;
    INSERT INTO public.payment_questions
      (payment_id, company_group_id, author_id, author_name, message, hospital_id, author_type, parent_id)
    VALUES (v_parent.payment_id, v_parent.company_group_id, auth.uid(), v_author_name,
            p_message, v_parent.hospital_id, 'interno', p_thread_id)
    RETURNING id INTO v_new_id;
  ELSIF p_channel = 'company_invoice' THEN
    INSERT INTO public.invoice_questions
      (invoice_id, payment_id, author_type, author_id, author_name, message, hospital_id)
    SELECT invoice_id, payment_id, 'analista', auth.uid(), v_author_name, p_message, hospital_id
      FROM public.invoice_questions WHERE id = p_thread_id
    RETURNING id INTO v_new_id;
    UPDATE public.invoice_questions
       SET status = 'respondida',
           answered_at = COALESCE(answered_at, now()),
           first_response_at = COALESCE(first_response_at, now())
     WHERE id = p_thread_id;
  ELSIF p_channel = 'doctor' THEN
    INSERT INTO public.doctor_messages
      (doctor_id, author_user_id, author_type, author_name, message, payment_id, hospital_id, thread_id)
    SELECT doctor_id, auth.uid(), 'equipe_interna', v_author_name, p_message, payment_id, hospital_id, p_thread_id
      FROM public.doctor_messages WHERE id = p_thread_id
    RETURNING id INTO v_new_id;
    UPDATE public.doctor_messages
       SET status = 'respondida',
           responded_at = COALESCE(responded_at, now()),
           first_response_at = COALESCE(first_response_at, now())
     WHERE id = p_thread_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target_id, metadata)
  VALUES (auth.uid(), 'comm_reply_on_behalf', p_thread_id,
          jsonb_build_object('channel', p_channel, 'on_behalf_of', p_on_behalf_of, 'new_message_id', v_new_id));

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.comm_reply_on_behalf(text,uuid,text,uuid) TO authenticated;
