CREATE OR REPLACE FUNCTION public.is_valid_status_transition(_from public.payment_status, _to public.payment_status)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _from IS NULL THEN true
    WHEN _from = _to THEN true
    WHEN _from = 'rascunho' AND _to IN ('em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'em_analise_ia' AND _to IN ('revisao_analista','em_analise_ia','cancelado') THEN true
    WHEN _from = 'revisao_analista' AND _to IN ('aguardando_validacao','em_analise_ia','cancelado','aguardando_aprovacao') THEN true
    WHEN _from = 'aguardando_validacao' AND _to IN ('aguardando_aprovacao','devolvido_analista','revisao_pos_aprovacao','cancelado') THEN true
    WHEN _from = 'devolvido_analista' AND _to IN ('aguardando_validacao','aguardando_aprovacao','em_analise_ia','revisao_analista','cancelado') THEN true
    WHEN _from = 'aguardando_aprovacao' AND _to IN ('aprovado','aprovado_em_revisao','aprovado_parcial','revisao_pos_aprovacao','em_questionamento','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'aprovado_em_revisao' AND _to IN ('pedido_nf_enviado','aprovado','revisao_pos_aprovacao','cancelado') THEN true
    WHEN _from = 'aprovado_parcial' AND _to IN ('aprovado','revisao_pos_aprovacao','pedido_nf_enviado','cancelado') THEN true
    WHEN _from = 'em_questionamento' AND _to IN ('aguardando_aprovacao','aprovado','aprovado_em_revisao','revisao_pos_aprovacao','devolvido_analista','rejeitado','cancelado') THEN true
    WHEN _from = 'revisao_pos_aprovacao' AND _to IN ('aguardando_aprovacao','aprovado','aprovado_em_revisao','pedido_nf_enviado','nf_recebida','cancelado') THEN true
    WHEN _from = 'aprovado' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','aprovado_com_ressalva','revisao_pos_aprovacao','cancelado') THEN true
    WHEN _from = 'aprovado_com_ressalva' AND _to IN ('pedido_nf_enviado','nf_recebida','nf_conciliada','nf_divergente','nf_questionada','pago','cancelado') THEN true
    WHEN _from = 'pedido_nf_enviado' AND _to IN ('nf_recebida','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_recebida' AND _to IN ('nf_conciliada','nf_divergente','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_questionada' AND _to IN ('nf_recebida','nf_conciliada','nf_divergente','cancelado') THEN true
    WHEN _from = 'nf_divergente' AND _to IN ('nf_conciliada','nf_questionada','cancelado') THEN true
    WHEN _from = 'nf_conciliada' AND _to IN ('lancado','pago','cancelado') THEN true
    WHEN _from = 'lancado' AND _to IN ('arquivado','pago','cancelado') THEN true
    WHEN _from = 'pago' AND _to = 'arquivado' THEN true
    ELSE false
  END;
$function$;