DELETE FROM public.payment_items
WHERE id = '11f3dbd0-1dea-4729-8156-063f8e90f7f7'
  AND tipo_linha = 'complemento_bonus'
  AND (applied_rule_label IS NULL OR applied_rule_label = '');