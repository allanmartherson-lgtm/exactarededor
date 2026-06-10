CREATE TABLE IF NOT EXISTS public.glosa_item_match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  glosa_item_id uuid NOT NULL REFERENCES public.glosa_items(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.glosa_batches(id) ON DELETE SET NULL,
  prev_status text,
  new_status text,
  prev_match_source text,
  new_match_source text,
  prev_company_id uuid,
  new_company_id uuid,
  prev_company_name text,
  new_company_name text,
  prev_match_reason text,
  new_match_reason text,
  event_kind text NOT NULL DEFAULT 'reprocess',
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gimh_item ON public.glosa_item_match_history(glosa_item_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gimh_batch ON public.glosa_item_match_history(batch_id, performed_at DESC);

GRANT SELECT ON public.glosa_item_match_history TO authenticated;
GRANT ALL ON public.glosa_item_match_history TO service_role;

ALTER TABLE public.glosa_item_match_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gimh_select_auth" ON public.glosa_item_match_history
  FOR SELECT TO authenticated USING (true);

-- Gatilho: grava histórico sempre que mudar algo relevante do match.
CREATE OR REPLACE FUNCTION public.glosa_items_record_match_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean := false;
  v_kind text := COALESCE(current_setting('app.glosa_match_event_kind', true), 'reprocess');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Só registra na criação se já vier com algum vínculo resolvido.
    IF NEW.match_source IS NOT NULL
       OR NEW.matched_company_id IS NOT NULL
       OR NEW.status IN ('vinculado','sem_match') THEN
      INSERT INTO public.glosa_item_match_history(
        glosa_item_id, batch_id,
        prev_status, new_status,
        prev_match_source, new_match_source,
        prev_company_id, new_company_id,
        prev_company_name, new_company_name,
        prev_match_reason, new_match_reason,
        event_kind, performed_by
      ) VALUES (
        NEW.id, NEW.batch_id,
        NULL, NEW.status,
        NULL, NEW.match_source,
        NULL, NEW.matched_company_id,
        NULL, NEW.matched_company_name,
        NULL, NEW.match_reason,
        COALESCE(NULLIF(v_kind,''), 'import'), auth.uid()
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: detecta qualquer mudança de match/status/empresa/motivo.
  v_changed := (NEW.status IS DISTINCT FROM OLD.status)
            OR (NEW.match_source IS DISTINCT FROM OLD.match_source)
            OR (NEW.matched_company_id IS DISTINCT FROM OLD.matched_company_id)
            OR (NEW.matched_company_name IS DISTINCT FROM OLD.matched_company_name)
            OR (NEW.match_reason IS DISTINCT FROM OLD.match_reason);

  IF v_changed THEN
    INSERT INTO public.glosa_item_match_history(
      glosa_item_id, batch_id,
      prev_status, new_status,
      prev_match_source, new_match_source,
      prev_company_id, new_company_id,
      prev_company_name, new_company_name,
      prev_match_reason, new_match_reason,
      event_kind, performed_by
    ) VALUES (
      NEW.id, NEW.batch_id,
      OLD.status, NEW.status,
      OLD.match_source, NEW.match_source,
      OLD.matched_company_id, NEW.matched_company_id,
      OLD.matched_company_name, NEW.matched_company_name,
      OLD.match_reason, NEW.match_reason,
      COALESCE(NULLIF(v_kind,''), 'reprocess'), auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_glosa_items_match_history ON public.glosa_items;
CREATE TRIGGER trg_glosa_items_match_history
  AFTER INSERT OR UPDATE ON public.glosa_items
  FOR EACH ROW
  EXECUTE FUNCTION public.glosa_items_record_match_history();

-- Função utilitária: recomputa saldo devedor de um médico a partir de glosa_items.
-- Evita inflar glosa_debts quando lote é reprocessado.
CREATE OR REPLACE FUNCTION public.glosa_recompute_debt_for_doctor(p_crm text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_key text := COALESCE(NULLIF(p_crm,''), p_name);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;

  SELECT COALESCE(SUM(valor_glosa), 0) INTO v_total
    FROM public.glosa_items
   WHERE COALESCE(NULLIF(doctor_crm,''), doctor_name) = v_key
     AND status NOT IN ('quitado','ignorado');

  IF v_total <= 0 THEN
    UPDATE public.glosa_debts
       SET total_debt = 0, status = 'quitado', updated_at = now()
     WHERE doctor_crm = v_key;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.glosa_debts WHERE doctor_crm = v_key) THEN
    UPDATE public.glosa_debts
       SET total_debt = v_total,
           doctor_name = COALESCE(p_name, doctor_name),
           status = 'ativo',
           updated_at = now()
     WHERE doctor_crm = v_key;
  ELSE
    INSERT INTO public.glosa_debts(doctor_crm, doctor_name, total_debt, status)
    VALUES (v_key, p_name, v_total, 'ativo');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.glosa_recompute_debt_for_doctor(text, text) TO authenticated, service_role;