WITH indevidas AS (
  SELECT caa.id, caa.payment_id, caa.company_id, caa.adjustment_id, caa.valor_aplicado, p.reference, p.status, p.hospital_id
  FROM company_adjustment_applications caa
  JOIN payments p ON p.id = caa.payment_id
  WHERE caa.status = 'proposto'
    AND caa.source = 'auto'
    AND p.status IN ('pago','arquivado','lancado','nf_conciliada','pedido_nf_enviado','nf_recebida','aprovado','aprovado_com_ressalva','aprovado_parcial','cancelado','rejeitado')
)
INSERT INTO audit_log (action, entity_type, entity_id, company_id, hospital_id, diff, created_at)
SELECT 'DELETE_PROPOSTA_LOTE_FINALIZADO',
       'company_adjustment_application',
       id,
       company_id,
       hospital_id,
       jsonb_build_object(
         'payment_id', payment_id,
         'adjustment_id', adjustment_id,
         'valor_aplicado', valor_aplicado,
         'payment_reference', reference,
         'payment_status', status,
         'motivo', 'Bug corrigido: motor não deve propor deduções em lotes finalizados'
       ),
       now()
FROM indevidas;

DELETE FROM company_adjustment_applications caa
USING payments p
WHERE p.id = caa.payment_id
  AND caa.status = 'proposto'
  AND caa.source = 'auto'
  AND p.status IN ('pago','arquivado','lancado','nf_conciliada','pedido_nf_enviado','nf_recebida','aprovado','aprovado_com_ressalva','aprovado_parcial','cancelado','rejeitado');