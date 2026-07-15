
-- 1) Atualiza o trigger para incluir revisao_pos_aprovacao e cobrir o caminho pré-aprovação → downstream
CREATE OR REPLACE FUNCTION public.tg_intervention_ledger_on_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_approved_states text[] := ARRAY[
    'aprovado','aprovado_com_ressalva','aprovado_em_revisao','aprovado_parcial',
    'revisao_pos_aprovacao'
  ];
  v_downstream text[] := ARRAY[
    'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente',
    'nf_conciliada','lancado','arquivado','pago'
  ];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Entrou em estado aprovado (não estava antes)
  IF NEW.status::text = ANY(v_approved_states)
     AND NOT (OLD.status::text = ANY(v_approved_states))
     AND NOT (OLD.status::text = ANY(v_downstream)) THEN
    PERFORM public.materialize_intervention_ledger(NEW.id);
    RETURN NEW;
  END IF;

  -- Pulou direto de pré-aprovação para downstream (sem passar por aprovado) → materializar também
  IF NEW.status::text = ANY(v_downstream)
     AND NOT (OLD.status::text = ANY(v_downstream))
     AND NOT (OLD.status::text = ANY(v_approved_states)) THEN
    PERFORM public.materialize_intervention_ledger(NEW.id);
    RETURN NEW;
  END IF;

  -- Saiu de aprovado/downstream para estado não aprovado/downstream → reverter
  -- (cobre revisao_pos_aprovacao → aguardando_aprovacao pois revisao_pos_aprovacao agora é "aprovado")
  IF (OLD.status::text = ANY(v_approved_states) OR OLD.status::text = ANY(v_downstream))
     AND NOT (NEW.status::text = ANY(v_approved_states))
     AND NOT (NEW.status::text = ANY(v_downstream)) THEN
    UPDATE public.intervention_ledger
      SET reverted_at = now(),
          reverted_reason = NEW.status::text
      WHERE payment_id = NEW.id AND reverted_at IS NULL;
  END IF;

  RETURN NEW;
END $function$;

-- 2) Backfill: rematerializar todos os lotes já em estados aprovados/downstream, excluindo históricos
DO $$
DECLARE
  v_approved_states text[] := ARRAY[
    'aprovado','aprovado_com_ressalva','aprovado_em_revisao','aprovado_parcial',
    'revisao_pos_aprovacao',
    'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente',
    'nf_conciliada','lancado','arquivado','pago'
  ];
  v_ledger_before bigint;
  v_ledger_after bigint;
  r record;
  v_count int := 0;
BEGIN
  SELECT count(*) INTO v_ledger_before FROM public.intervention_ledger;

  FOR r IN
    SELECT id FROM public.payments
     WHERE status::text = ANY(v_approved_states)
       AND (import_mode IS NULL OR import_mode <> 'historico')
  LOOP
    PERFORM public.materialize_intervention_ledger(r.id);
    v_count := v_count + 1;
  END LOOP;

  SELECT count(*) INTO v_ledger_after FROM public.intervention_ledger;

  RAISE NOTICE 'Backfill: % lotes materializados; ledger % → % (Δ %)',
    v_count, v_ledger_before, v_ledger_after, v_ledger_after - v_ledger_before;

  -- Log por hospital
  FOR r IN
    SELECT h.name AS hospital_name, count(*) AS lotes
      FROM public.payments p
      JOIN public.hospitals h ON h.id = p.hospital_id
     WHERE p.status::text = ANY(v_approved_states)
       AND (p.import_mode IS NULL OR p.import_mode <> 'historico')
     GROUP BY h.name
     ORDER BY h.name
  LOOP
    RAISE NOTICE 'Hospital %: % lotes elegíveis', r.hospital_name, r.lotes;
  END LOOP;
END $$;
