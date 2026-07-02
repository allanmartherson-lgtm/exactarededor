
-- =============================================================
-- 1. Tabela intervention_ledger
-- =============================================================
CREATE TABLE IF NOT EXISTS public.intervention_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.payment_items(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  company_id uuid,
  company_name text,
  doctor_name text,
  procedure_code text,
  procedure_name text,
  valor_regra numeric NOT NULL DEFAULT 0,
  valor_pago_final numeric NOT NULL DEFAULT 0,
  delta numeric NOT NULL DEFAULT 0,
  fonte text NOT NULL CHECK (fonte IN (
    'cancelamento','glosa','ajuste_manual','aceite_pago','aceite_esperado','sem_intervencao'
  )),
  cancellation_reason text,
  autor_id uuid,
  approved_at timestamptz NOT NULL,
  approved_by uuid,
  reverted_at timestamptz,
  reverted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, approved_at)
);

GRANT SELECT ON public.intervention_ledger TO authenticated;
GRANT ALL ON public.intervention_ledger TO service_role;

ALTER TABLE public.intervention_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_read_scoped"
  ON public.intervention_ledger FOR SELECT
  TO authenticated
  USING (
    hospital_id = current_active_hospital()
    AND (
      has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'analista'::app_role)
    )
  );

CREATE INDEX IF NOT EXISTS idx_ledger_hospital_approved
  ON public.intervention_ledger (hospital_id, approved_at DESC)
  WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_payment
  ON public.intervention_ledger (payment_id);
CREATE INDEX IF NOT EXISTS idx_ledger_autor
  ON public.intervention_ledger (autor_id, approved_at DESC)
  WHERE reverted_at IS NULL;

-- =============================================================
-- 2. Função que materializa o ledger para um payment
-- =============================================================
CREATE OR REPLACE FUNCTION public.materialize_intervention_ledger(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment record;
  v_glosa_by_company jsonb;
BEGIN
  SELECT id, status, approved_at, approved_by, hospital_id
    INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Limpa entradas antigas (segurança em caso de reprocessamento)
  DELETE FROM public.intervention_ledger WHERE payment_id = p_payment_id;

  -- Set de companies com glosa aplicada nesse payment
  SELECT COALESCE(jsonb_object_agg(company_id::text, true), '{}'::jsonb)
    INTO v_glosa_by_company
    FROM (
      SELECT DISTINCT company_id
      FROM public.glosa_payment_applications
      WHERE payment_id = p_payment_id AND reverted_at IS NULL
    ) g;

  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by
  )
  SELECT
    pi.payment_id,
    pi.id,
    v_payment.hospital_id,
    pi.company_id,
    pi.company_name,
    pi.doctor_name,
    pi.procedure_code,
    pi.procedure_name,
    COALESCE(pi.expected_amount, 0)                        AS valor_regra,
    COALESCE(pi.gross_amount, 0)                           AS valor_pago_final,
    COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0) AS delta,
    CASE
      WHEN pi.is_cancelled THEN 'cancelamento'
      WHEN pi.company_id IS NOT NULL
        AND (v_glosa_by_company ? pi.company_id::text) THEN 'glosa'
      WHEN pi.gross_override_at IS NOT NULL THEN 'ajuste_manual'
      WHEN pi.acatado_at IS NOT NULL
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 'aceite_esperado'
      WHEN pi.acatado_at IS NOT NULL THEN 'aceite_pago'
      WHEN ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 'sem_intervencao'
      ELSE 'ajuste_manual'
    END AS fonte,
    CASE WHEN pi.is_cancelled THEN pi.cancellation_reason::text ELSE NULL END,
    COALESCE(pi.cancelled_by, pi.gross_override_by, pi.acatado_by, v_payment.approved_by) AS autor_id,
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  -- Doctor_id column doesn't exist on payment_items directly? use doctor_name only.
END $$;

-- =============================================================
-- 3. Trigger de aprovação/reversão em payments
-- =============================================================
CREATE OR REPLACE FUNCTION public.tg_intervention_ledger_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved_states text[] := ARRAY[
    'aprovado','aprovado_com_ressalva','aprovado_em_revisao','aprovado_parcial'
  ];
  v_downstream text[] := ARRAY[
    'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente',
    'nf_conciliada','lancado','arquivado','pago'
  ];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Entrou no estado aprovado (não estava antes)
  IF NEW.status::text = ANY(v_approved_states)
     AND NOT (OLD.status::text = ANY(v_approved_states))
     AND NOT (OLD.status::text = ANY(v_downstream)) THEN
    PERFORM public.materialize_intervention_ledger(NEW.id);
    RETURN NEW;
  END IF;

  -- Saiu de aprovado (ou downstream) para um estado não aprovado/downstream → reverter
  IF (OLD.status::text = ANY(v_approved_states) OR OLD.status::text = ANY(v_downstream))
     AND NOT (NEW.status::text = ANY(v_approved_states))
     AND NOT (NEW.status::text = ANY(v_downstream)) THEN
    UPDATE public.intervention_ledger
      SET reverted_at = now(),
          reverted_reason = NEW.status::text
      WHERE payment_id = NEW.id AND reverted_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_intervention_ledger ON public.payments;
CREATE TRIGGER payments_intervention_ledger
  AFTER UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_intervention_ledger_on_status();

-- =============================================================
-- 4. Refactor de get_intervention_savings
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role,'admin'::app_role,'validador'::app_role,'analista'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH rows AS (
    SELECT l.*
    FROM public.intervention_ledger l
    WHERE l.approved_at BETWEEN p_start AND p_end
      AND l.reverted_at IS NULL
      AND (p_hospital_id IS NULL OR l.hospital_id = p_hospital_id)
      AND l.fonte <> 'sem_intervencao'
  ),
  neutro AS (
    -- Cancelamentos operacionais (motivos que não são economia real) — não somam saldo
    SELECT *,
      CASE
        WHEN fonte = 'cancelamento'
         AND (cancellation_reason IS NULL
              OR cancellation_reason NOT IN (
                'medico_fatura_externamente','contrato_encerrado','glosa_total_quitada',
                'decisao_juridica','duplicidade_externa','economia_real'
              ))
        THEN true ELSE false
      END AS is_neutro
    FROM rows
  ),
  summary AS (
    SELECT
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(CASE WHEN is_neutro THEN ABS(delta) ELSE 0 END), 0) AS neutro,
      COUNT(*) AS qtd_itens
    FROM neutro
  ),
  by_role AS (
    SELECT fonte AS role,
      COALESCE(SUM(CASE WHEN NOT is_neutro THEN delta ELSE 0 END), 0) AS saldo,
      COUNT(*) AS qtd
    FROM neutro GROUP BY fonte
  ),
  by_user AS (
    SELECT
      autor_id AS user_id,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = autor_id), 'Sistema') AS nome,
      MIN(fonte) AS role,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(CASE WHEN NOT is_neutro THEN delta ELSE 0 END), 0) AS saldo
    FROM neutro
    WHERE autor_id IS NOT NULL
    GROUP BY autor_id
  ),
  items AS (
    SELECT
      item_id, payment_id,
      item_id::text AS obs_id,
      valor_regra, valor_pago_final, delta,
      autor_id AS author_id,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = autor_id), 'Sistema') AS autor,
      fonte AS role,
      approved_at AS obs_at,
      approved_at AS acatado_at,
      doctor_name, procedure_code, procedure_name, company_name,
      NULL::uuid AS company_group_id,
      cancellation_reason
    FROM neutro
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'economia', (SELECT economia FROM summary),
      'perda',    (SELECT perda    FROM summary),
      'neutro',   (SELECT neutro   FROM summary),
      'saldo',    (SELECT economia - perda FROM summary),
      'qtd_itens',(SELECT qtd_itens FROM summary)
    ),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM items i), '[]'::jsonb),
    'window',  jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', p_hospital_id)
  ) INTO v_result;

  RETURN v_result;
END $$;

-- =============================================================
-- 5. Backfill: popula o ledger com todos os payments já aprovados
-- =============================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.payments
    WHERE status::text IN (
      'aprovado','aprovado_com_ressalva','aprovado_em_revisao','aprovado_parcial',
      'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente',
      'nf_conciliada','lancado','arquivado','pago'
    )
  LOOP
    PERFORM public.materialize_intervention_ledger(r.id);
  END LOOP;
END $$;
