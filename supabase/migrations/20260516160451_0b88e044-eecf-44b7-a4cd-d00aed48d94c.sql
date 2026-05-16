CREATE OR REPLACE FUNCTION public.recompute_payment_status_from_groups(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
 DECLARE
   total_groups integer; s_aprovado integer; s_rejeitado integer; s_cancelado integer;
   s_em_analise integer; s_revisao integer; s_concluida integer; s_dev_analista integer;
   s_aguard_val integer; s_aguard_apr integer; s_apr_revisao integer;
   s_arquivado integer;
   new_status public.payment_status;
 BEGIN
   SELECT count(*),
     count(*) FILTER (WHERE status='aprovado'), count(*) FILTER (WHERE status='rejeitado'),
     count(*) FILTER (WHERE status='cancelado'), count(*) FILTER (WHERE status='em_analise_ia'),
     count(*) FILTER (WHERE status='revisao_analista'),
     count(*) FILTER (WHERE status='concluida_analista'),
     count(*) FILTER (WHERE status='devolvido_analista'),
     count(*) FILTER (WHERE status='aguardando_validacao'), count(*) FILTER (WHERE status='aguardando_aprovacao'),
     count(*) FILTER (WHERE status='aprovado_em_revisao'),
     count(*) FILTER (WHERE status='arquivado')
   INTO total_groups, s_aprovado, s_rejeitado, s_cancelado, s_em_analise, s_revisao,
        s_concluida, s_dev_analista, s_aguard_val, s_aguard_apr, s_apr_revisao, s_arquivado
   FROM public.payment_company_groups WHERE payment_id = _payment_id;

   IF total_groups = 0 THEN RETURN; END IF;

   IF s_em_analise > 0 THEN new_status := 'em_analise_ia';
   ELSIF s_revisao > 0 THEN new_status := 'revisao_analista';
   ELSIF s_concluida > 0 THEN new_status := 'revisao_analista';
   ELSIF s_dev_analista > 0 THEN new_status := 'devolvido_analista';
   ELSIF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
   ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
   ELSIF s_apr_revisao > 0 THEN new_status := 'aprovado_em_revisao';
   ELSIF s_arquivado = total_groups THEN new_status := 'arquivado';
   ELSIF (s_aprovado + s_rejeitado + s_cancelado) = total_groups THEN
     IF s_aprovado > 0 THEN new_status := 'aprovado';
     ELSIF s_rejeitado = total_groups THEN new_status := 'rejeitado';
     ELSE new_status := 'cancelado'; END IF;
   ELSE
     IF s_aguard_val > 0 THEN new_status := 'aguardando_validacao';
     ELSIF s_aguard_apr > 0 THEN new_status := 'aguardando_aprovacao';
     ELSIF s_apr_revisao > 0 THEN new_status := 'aprovado_em_revisao';
     ELSE new_status := 'aguardando_validacao';
     END IF;
   END IF;

   PERFORM set_config('app.allow_payment_status_write', 'on', true);
   UPDATE public.payments SET status = new_status, updated_at = now() WHERE id = _payment_id;
   PERFORM set_config('app.allow_payment_status_write', 'off', true);
 END;
$function$;