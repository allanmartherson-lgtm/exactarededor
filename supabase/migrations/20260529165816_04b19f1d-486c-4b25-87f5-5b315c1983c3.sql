-- ============================================================
-- 6 RPCs do portal Médico Conectado
-- ============================================================

-- 1. get_doctor_glosas
CREATE OR REPLACE FUNCTION public.get_doctor_glosas(
  p_doctor_id uuid,
  p_status     text    DEFAULT NULL,
  p_competencia date   DEFAULT NULL,
  p_company_id  uuid   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_crm text;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT crm INTO v_crm FROM public.doctors WHERE id = p_doctor_id;
  IF v_crm IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        gi.id,
        gi.batch_id,
        gi.matched_payment_id       AS payment_id,
        gi.matched_payment_item_id  AS payment_item_id,
        CASE
          WHEN gb.competence_month IS NOT NULL
            THEN date_trunc('month', gb.competence_month::date)::text
          WHEN mp.competence_month IS NOT NULL
            THEN mp.competence_month::text
          ELSE NULL
        END                          AS competence_month,
        gi.procedure_code,
        gi.procedure_name,
        gi.patient_name,
        gi.valor_glosa               AS glosa_amount,
        gi.motivo_glosa              AS operadora_reason,
        CASE
          WHEN gd.status = 'quitado'       THEN 'quitada'
          WHEN gd.status = 'contestado'    THEN 'contestada'
          WHEN gd.status = 'em_negociacao' THEN 'em_negociacao'
          ELSE 'pendente'
        END                          AS debt_status,
        gd.company_id,
        c.name                       AS company_name,
        gi.created_at
      FROM public.glosa_items gi
      LEFT JOIN public.glosa_batches gb      ON gb.id = gi.batch_id
      LEFT JOIN public.payments mp           ON mp.id = gi.matched_payment_id
      LEFT JOIN public.glosa_debt_items gdi  ON gdi.glosa_item_id = gi.id
      LEFT JOIN public.glosa_debts gd        ON gd.id = gdi.debt_id
                                             AND gd.doctor_crm = v_crm
      LEFT JOIN public.companies c           ON c.id = gd.company_id
      WHERE gi.doctor_crm = v_crm
        AND (p_status IS NULL OR (
          CASE
            WHEN gd.status = 'quitado'       THEN 'quitada'
            WHEN gd.status = 'contestado'    THEN 'contestada'
            WHEN gd.status = 'em_negociacao' THEN 'em_negociacao'
            ELSE 'pendente'
          END = p_status
        ))
        AND (
          p_competencia IS NULL
          OR (gb.competence_month IS NOT NULL
              AND date_trunc('month', gb.competence_month::date) = date_trunc('month', p_competencia))
          OR (mp.competence_month IS NOT NULL
              AND mp.competence_month = date_trunc('month', p_competencia))
        )
        AND (p_company_id IS NULL OR gd.company_id = p_company_id)
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_glosas(uuid, text, date, uuid) TO authenticated;

-- 2. get_doctor_debt_summary
CREATE OR REPLACE FUNCTION public.get_doctor_debt_summary(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_crm text;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT crm INTO v_crm FROM public.doctors WHERE id = p_doctor_id;
  IF v_crm IS NULL THEN
    RETURN jsonb_build_object(
      'total_pendente',   0,
      'total_quitado',    0,
      'total_contestado', 0,
      'por_pj',           '[]'::jsonb
    );
  END IF;

  RETURN (
    WITH debts AS (
      SELECT
        gd.total_debt,
        gd.status,
        gd.company_id,
        gd.ignored_at,
        c.name AS company_name
      FROM public.glosa_debts gd
      LEFT JOIN public.companies c ON c.id = gd.company_id
      WHERE gd.doctor_crm = v_crm
        AND gd.ignored_at IS NULL
    )
    SELECT jsonb_build_object(
      'total_pendente',
        COALESCE(SUM(total_debt) FILTER (WHERE status NOT IN ('quitado','contestado')), 0),
      'total_quitado',
        COALESCE(SUM(total_debt) FILTER (WHERE status = 'quitado'), 0),
      'total_contestado',
        COALESCE(SUM(total_debt) FILTER (WHERE status = 'contestado'), 0),
      'por_pj',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'company_id',   company_id,
              'company_name', company_name,
              'saldo',        total_debt
            )
            ORDER BY total_debt DESC
          ) FILTER (WHERE status NOT IN ('quitado')),
          '[]'::jsonb
        )
    )
    FROM debts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_debt_summary(uuid) TO authenticated;

-- 3. get_doctor_profile
CREATE OR REPLACE FUNCTION public.get_doctor_profile(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d    public.doctors%rowtype;
  v_email text;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT d.* INTO v_d FROM public.doctors d WHERE d.id = p_doctor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = '02000';
  END IF;

  SELECT au.email INTO v_email
    FROM public.doctor_portal_users dpu
    JOIN auth.users au ON au.id = dpu.user_id
   WHERE dpu.doctor_id = p_doctor_id
     AND dpu.active = true
   ORDER BY dpu.accepted_at NULLS LAST, dpu.invited_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'id',               v_d.id,
    'full_name',        v_d.full_name,
    'crm',              v_d.crm,
    'crm_uf',           v_d.crm_uf,
    'cpf',
      CASE WHEN v_d.cpf IS NOT NULL
        THEN REGEXP_REPLACE(v_d.cpf, '(\d{3})\d{3}(\d{3})(\d{2})', '\1.***.***-\3')
        ELSE NULL
      END,
    'email',            COALESCE(v_email, v_d.email),
    'email_secundario', v_d.email,
    'phone',            v_d.phone,
    'especialidades',   COALESCE(to_jsonb(v_d.specialties), '[]'::jsonb),
    'created_at',       v_d.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_profile(uuid) TO authenticated;

-- 4. update_doctor_profile
CREATE OR REPLACE FUNCTION public.update_doctor_profile(
  p_phone            text DEFAULT NULL,
  p_email_secundario text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doctor_id uuid;
BEGIN
  v_doctor_id := public.portal_current_doctor_id();
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.doctors
     SET phone      = COALESCE(p_phone, phone),
         email      = COALESCE(p_email_secundario, email),
         updated_at = now()
   WHERE id = v_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_doctor_profile(text, text) TO authenticated;

-- 5. get_doctor_linked_companies
CREATE OR REPLACE FUNCTION public.get_doctor_linked_companies(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r ORDER BY r.company_name), '[]'::jsonb)
    FROM (
      SELECT
        dc.company_id,
        c.name       AS company_name,
        c.document   AS cnpj,
        'ativa'::text AS status_vinculo,
        dc.created_at AS vinculado_desde
      FROM public.doctor_companies dc
      JOIN public.companies c ON c.id = dc.company_id
      WHERE dc.doctor_id = p_doctor_id
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_linked_companies(uuid) TO authenticated;

-- 6. get_doctor_activity_log
CREATE OR REPLACE FUNCTION public.get_doctor_activity_log(
  p_doctor_id uuid,
  p_limit     int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        al.id,
        al.action,
        al.action               AS description,
        NULL::text              AS ip_address,
        NULL::text              AS user_agent,
        al.created_at
      FROM public.audit_log al
      WHERE al.entity_type = 'doctor'
        AND al.entity_id = p_doctor_id
      ORDER BY al.created_at DESC
      LIMIT LEAST(p_limit, 100)
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_activity_log(uuid, int) TO authenticated;