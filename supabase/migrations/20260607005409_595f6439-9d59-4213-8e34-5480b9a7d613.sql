-- Aprovar manualmente a campanha "teste" que ficou travada na UI para
-- validar que o trigger on_campaign_decision dispara notificações + broadcast.
UPDATE public.comm_campaigns
   SET approval_status = 'approved',
       approved_by     = 'f8a4b4ef-0523-497c-9bce-9de7ed332df7',
       approved_at     = now(),
       rejection_reason = NULL
 WHERE id = '39bf167d-6838-4c8f-8370-782bfdb58ba4'
   AND approval_status = 'pending';