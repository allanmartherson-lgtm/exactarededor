
-- Detalhe enriquecido de um item (para tela /item/:id no portal)
CREATE OR REPLACE FUNCTION public.get_portal_item_detail(p_item_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_rule RECORD;
  v_payment RECORD;
BEGIN
  SELECT pi.*, p.status AS payment_status, p.competence_month, p.reference AS payment_reference
    INTO v_item
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE pi.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado';
  END IF;

  IF NOT public.portal_can_access_doctor(v_item.doctor_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar este item';
  END IF;

  IF v_item.applied_rule_id IS NOT NULL THEN
    SELECT id, name, description, rule_type, scope, severity
      INTO v_rule
    FROM rules
    WHERE id = v_item.applied_rule_id;
  END IF;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'payment_id', v_item.payment_id,
      'payment_reference', v_item.payment_reference,
      'payment_status', v_item.payment_status,
      'competence_month', v_item.competence_month,
      'company_name', v_item.company_name,
      'attendance_number', v_item.attendance_number,
      'procedure_code', v_item.procedure_code,
      'procedure_name', v_item.procedure_name,
      'procedure_date', v_item.procedure_date,
      'description', v_item.description,
      'tipo_item', v_item.tipo_item,
      'tipo_linha', v_item.tipo_linha,
      'sector', v_item.sector,
      'specialty', v_item.specialty,
      'access_route', v_item.access_route,
      'doctor_role', v_item.doctor_role,
      'agreement_text', v_item.agreement_text,
      'gross_amount', v_item.gross_amount,
      'procedure_amount', v_item.procedure_amount,
      'expected_amount', v_item.expected_amount,
      'quantity', v_item.quantity,
      'ai_status', v_item.ai_status,
      'patient_name', v_item.patient_name
    ),
    'alerts', COALESCE(v_item.ai_findings, '[]'::jsonb),
    'validation_findings', COALESCE(v_item.validation_findings, '[]'::jsonb),
    'applied_rule', CASE
      WHEN v_rule.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_rule.id,
        'name', v_rule.name,
        'description', v_rule.description,
        'rule_type', v_rule.rule_type,
        'scope', v_rule.scope,
        'severity', v_rule.severity,
        'applied_label', v_item.applied_rule_label,
        'applied_calc_method', v_item.applied_calc_method,
        'applied_at', v_item.applied_at
      )
    END,
    'exception', CASE
      WHEN COALESCE(v_item.authorized_exception, false) = false THEN NULL
      ELSE jsonb_build_object(
        'authorized', true,
        'reason', v_item.exception_reason,
        'note', v_item.exception_note,
        'authorizer', v_item.exception_authorizer,
        'marked_at', v_item.exception_marked_at
      )
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_item_detail(UUID) TO authenticated;

-- Timeline de status do pagamento (para tela /item/:id e /extrato/:competencia)
CREATE OR REPLACE FUNCTION public.get_portal_payment_timeline(p_payment_id UUID)
RETURNS TABLE (
  status_from TEXT,
  status_to TEXT,
  changed_at TIMESTAMPTZ,
  changed_by_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_access BOOLEAN := false;
BEGIN
  -- Acesso: o médico autenticado precisa ter ao menos 1 item nesse pagamento
  SELECT EXISTS (
    SELECT 1
    FROM payment_items pi
    WHERE pi.payment_id = p_payment_id
      AND public.portal_can_access_doctor(pi.doctor_id)
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Sem permissão para acessar este pagamento';
  END IF;

  RETURN QUERY
  SELECT
    psh.status_from::TEXT,
    psh.status_to::TEXT,
    psh.changed_at,
    COALESCE(pr.full_name, 'Sistema')::TEXT
  FROM payment_status_history psh
  LEFT JOIN profiles pr ON pr.id = psh.changed_by
  WHERE psh.payment_id = p_payment_id
  ORDER BY psh.changed_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_payment_timeline(UUID) TO authenticated;
