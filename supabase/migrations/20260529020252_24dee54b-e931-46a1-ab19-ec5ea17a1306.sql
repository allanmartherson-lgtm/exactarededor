-- ============================================================
-- Canal de conversas empresa <-> analista (Exacta)
-- ============================================================

-- 1) Threads
CREATE TABLE IF NOT EXISTS public.company_threads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope                 text NOT NULL CHECK (scope IN ('geral','lote','nf','pendencia')),
  payment_id            uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  invoice_id            uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  subject               text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  status                text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida')),
  created_by_type       text NOT NULL CHECK (created_by_type IN ('empresa','analista')),
  created_by_user_id    uuid REFERENCES auth.users(id),
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  last_message_preview  text,
  unread_for_company    int NOT NULL DEFAULT 0,
  unread_for_internal   int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ct_company ON public.company_threads(company_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_payment ON public.company_threads(payment_id);
CREATE INDEX IF NOT EXISTS idx_ct_invoice ON public.company_threads(invoice_id);

GRANT SELECT, INSERT, UPDATE ON public.company_threads TO authenticated;
GRANT ALL ON public.company_threads TO service_role;

ALTER TABLE public.company_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ct_company_select" ON public.company_threads
  FOR SELECT TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

CREATE POLICY "ct_company_insert" ON public.company_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_type = 'empresa'
    AND created_by_user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "ct_company_update" ON public.company_threads
  FOR UPDATE TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

CREATE POLICY "ct_internal_all" ON public.company_threads
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ));

-- 2) Mensagens
CREATE TABLE IF NOT EXISTS public.company_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.company_threads(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  author_user_id      uuid REFERENCES auth.users(id),
  author_type         text NOT NULL CHECK (author_type IN ('empresa','analista','sistema')),
  author_name         text NOT NULL,
  message             text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  read_by_company_at  timestamptz,
  read_by_internal_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cm_thread  ON public.company_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cm_company ON public.company_messages(company_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.company_messages TO authenticated;
GRANT ALL ON public.company_messages TO service_role;

ALTER TABLE public.company_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cm_company_select" ON public.company_messages
  FOR SELECT TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

CREATE POLICY "cm_company_insert" ON public.company_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_type = 'empresa'
    AND author_user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "cm_company_update_read" ON public.company_messages
  FOR UPDATE TO authenticated
  USING (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.company_portal_users
    WHERE user_id = auth.uid() AND active = true
  ));

CREATE POLICY "cm_internal_all" ON public.company_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','analista','validador','diretor')
  ));

-- 3) Trigger
CREATE OR REPLACE FUNCTION public.fn_company_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_threads
     SET last_message_at      = NEW.created_at,
         last_message_preview = left(NEW.message, 140),
         unread_for_company   = CASE WHEN NEW.author_type = 'empresa' THEN unread_for_company   ELSE unread_for_company   + 1 END,
         unread_for_internal  = CASE WHEN NEW.author_type = 'empresa' THEN unread_for_internal  + 1 ELSE unread_for_internal END
   WHERE id = NEW.thread_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_company_messages_after_insert ON public.company_messages;
CREATE TRIGGER trg_company_messages_after_insert
AFTER INSERT ON public.company_messages
FOR EACH ROW EXECUTE FUNCTION public.fn_company_messages_after_insert();

-- 4) Realtime
ALTER TABLE public.company_threads REPLICA IDENTITY FULL;
ALTER TABLE public.company_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_messages;