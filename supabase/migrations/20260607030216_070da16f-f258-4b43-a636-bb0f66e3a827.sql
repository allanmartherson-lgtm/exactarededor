update public.payment_items
set ai_findings = coalesce(ai_findings, '{}'::jsonb)
  || jsonb_build_object(
       'expected_amount', expected_amount,
       'calculation_type', 'bonus',
       'applied_rule_label', applied_rule_label,
       'applied_rule_id', applied_rule_id
     )
where tipo_linha = 'complemento_bonus'
  and expected_amount is not null
  and (ai_findings is null or not (ai_findings ? 'expected_amount'));