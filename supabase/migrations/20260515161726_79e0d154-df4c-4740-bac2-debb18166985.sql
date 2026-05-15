
-- Tabela para itens cuja empresa (PJ) não foi identificada com confiança suficiente
-- durante a importação. Esses itens NÃO entram em payment_items nem em
-- payment_company_groups — ficam em quarentena até serem resolvidos pelo analista.
CREATE TABLE public.payment_unmatched_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  source_file text,
  raw_company_name text NOT NULL,
  match_score numeric NOT NULL DEFAULT 0,
  match_suggestion_id uuid,
  match_suggestion_name text,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- snapshot de campos do payment_items para migração futura
  doctor_name text,
  doctor_document text,
  doctor_email text,
  description text,
  gross_amount numeric NOT NULL DEFAULT 0,
  attendance_number text,
  procedure_code text,
  procedure_name text,
  access_route text,
  doctor_role text,
  agreement_text text,
  specialty text,
  procedure_amount numeric,
  quantity numeric,
  procedure_date timestamptz,
  patient_name text,
  sector text,
  tipo_linha text,
  convenio_value_totalized boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',  -- pending | linked | ignored
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_company_id uuid,
  ignored_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pui_payment ON public.payment_unmatched_items(payment_id);
CREATE INDEX idx_pui_status ON public.payment_unmatched_items(payment_id, status);
CREATE INDEX idx_pui_raw_name ON public.payment_unmatched_items(raw_company_name);

ALTER TABLE public.payment_unmatched_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pui_view_workflow ON public.payment_unmatched_items
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analista'::app_role) OR
    has_role(auth.uid(), 'validador'::app_role) OR
    has_role(auth.uid(), 'diretor'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY pui_manage_workflow ON public.payment_unmatched_items
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'analista'::app_role) OR
    has_role(auth.uid(), 'validador'::app_role) OR
    has_role(auth.uid(), 'diretor'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'analista'::app_role) OR
    has_role(auth.uid(), 'validador'::app_role) OR
    has_role(auth.uid(), 'diretor'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER pui_set_updated_at
  BEFORE UPDATE ON public.payment_unmatched_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: aprende um apelido para uma empresa (idempotente)
CREATE OR REPLACE FUNCTION public.learn_company_alias(
  _company_id uuid,
  _raw_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed text;
BEGIN
  trimmed := btrim(coalesce(_raw_name, ''));
  IF trimmed = '' OR _company_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.companies
     SET aliases = (
       SELECT array_agg(DISTINCT a)
       FROM unnest(coalesce(aliases, '{}'::text[]) || ARRAY[trimmed]) a
     ),
     updated_at = now()
   WHERE id = _company_id
     AND NOT (trimmed = ANY(coalesce(aliases, '{}'::text[])));
END;
$$;

-- RPC: vincula itens órfãos a uma empresa cadastrada e os move para payment_items.
-- Retorna a quantidade de itens migrados.
CREATE OR REPLACE FUNCTION public.link_unmatched_items_to_company(
  _payment_id uuid,
  _raw_company_name text,
  _company_id uuid,
  _learn_alias boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved_count integer := 0;
  resolved_company_name text;
BEGIN
  IF _payment_id IS NULL OR _company_id IS NULL OR coalesce(btrim(_raw_company_name), '') = '' THEN
    RAISE EXCEPTION 'parâmetros obrigatórios ausentes';
  END IF;

  SELECT name INTO resolved_company_name FROM public.companies WHERE id = _company_id;
  IF resolved_company_name IS NULL THEN
    RAISE EXCEPTION 'empresa % não encontrada', _company_id;
  END IF;

  IF _learn_alias THEN
    PERFORM public.learn_company_alias(_company_id, _raw_company_name);
  END IF;

  WITH src AS (
    SELECT * FROM public.payment_unmatched_items
     WHERE payment_id = _payment_id
       AND raw_company_name = _raw_company_name
       AND status = 'pending'
     FOR UPDATE
  ),
  ins AS (
    INSERT INTO public.payment_items (
      payment_id, doctor_name, doctor_document, doctor_email, description,
      gross_amount, company_name, company_id, attendance_number, procedure_code,
      procedure_name, access_route, doctor_role, agreement_text, specialty,
      procedure_amount, quantity, procedure_date, patient_name, sector,
      raw_data, tipo_linha, convenio_value_totalized
    )
    SELECT
      payment_id, doctor_name, doctor_document, doctor_email, description,
      gross_amount, resolved_company_name, _company_id, attendance_number, procedure_code,
      procedure_name, access_route, doctor_role, agreement_text, specialty,
      procedure_amount, quantity, procedure_date, patient_name, sector,
      raw_data, tipo_linha, convenio_value_totalized
    FROM src
    RETURNING 1
  )
  SELECT count(*)::int INTO moved_count FROM ins;

  UPDATE public.payment_unmatched_items
     SET status = 'linked',
         resolved_at = now(),
         resolved_by = auth.uid(),
         resolved_company_id = _company_id
   WHERE payment_id = _payment_id
     AND raw_company_name = _raw_company_name
     AND status = 'pending';

  RETURN moved_count;
END;
$$;

-- RPC: ignora um grupo de itens órfãos (não migra nada, só marca como ignorado).
CREATE OR REPLACE FUNCTION public.ignore_unmatched_items(
  _payment_id uuid,
  _raw_company_name text,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.payment_unmatched_items
     SET status = 'ignored',
         resolved_at = now(),
         resolved_by = auth.uid(),
         ignored_reason = _reason
   WHERE payment_id = _payment_id
     AND raw_company_name = _raw_company_name
     AND status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
