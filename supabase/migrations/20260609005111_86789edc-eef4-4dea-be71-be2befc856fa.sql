-- Trigger que garante: reconciliation_items só registra ação quando o pagamento
-- associado está na ETAPA DE ANÁLISE. Bloqueia mistura com fluxo de NF.

CREATE OR REPLACE FUNCTION public.enforce_recon_action_analysis_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_status text;
  v_payment_id uuid;
  v_analysis_stage CONSTANT text[] := ARRAY[
    'rascunho',
    'em_confeccao',
    'em_analise_ia',
    'revisao_analista',
    'concluida_analista',
    'devolvido_analista',
    'aprovado_em_revisao',
    'aguardando_validacao',
    'aguardando_aprovacao'
  ];
  v_valid_actions CONSTANT text[] := ARRAY[
    'ignorar',
    'revisar_manual',
    'marcar_glosa',
    'incorporar_credito',
    'incorporar_debito',
    'cancelado_conciliacao'
  ];
BEGIN
  -- Só atua quando action_taken está sendo SETADO (transição NULL→valor ou troca).
  IF NEW.action_taken IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.action_taken IS NOT DISTINCT FROM OLD.action_taken THEN
    RETURN NEW;
  END IF;

  -- Valida valor permitido (defesa em profundidade).
  IF NOT (NEW.action_taken = ANY(v_valid_actions)) THEN
    RAISE EXCEPTION 'invalid_action_taken: %', NEW.action_taken;
  END IF;

  -- Descobre o pagamento via payment_item_id ou applied_payment_id.
  IF NEW.payment_item_id IS NOT NULL THEN
    SELECT pi.payment_id INTO v_payment_id
      FROM public.payment_items pi
     WHERE pi.id = NEW.payment_item_id;
  END IF;

  IF v_payment_id IS NULL AND NEW.applied_payment_id IS NOT NULL THEN
    v_payment_id := NEW.applied_payment_id;
  END IF;

  -- Sem pagamento associado → linha "só hospital" sem vínculo. Permitido apenas
  -- para ações que não tocam payment_items (ignorar / revisar_manual / marcar_glosa).
  IF v_payment_id IS NULL THEN
    IF NEW.action_taken IN ('cancelado_conciliacao', 'incorporar_credito', 'incorporar_debito') THEN
      RAISE EXCEPTION 'recon_action_requires_payment: %', NEW.action_taken;
    END IF;
    RETURN NEW;
  END IF;

  SELECT status::text INTO v_payment_status
    FROM public.payments
   WHERE id = v_payment_id;

  IF v_payment_status IS NULL THEN
    RAISE EXCEPTION 'recon_action_payment_not_found';
  END IF;

  IF NOT (v_payment_status = ANY(v_analysis_stage)) THEN
    RAISE EXCEPTION 'recon_action_payment_not_in_analysis_stage: status=%', v_payment_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_recon_action_analysis_stage ON public.reconciliation_items;
CREATE TRIGGER trg_enforce_recon_action_analysis_stage
  BEFORE INSERT OR UPDATE OF action_taken ON public.reconciliation_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_recon_action_analysis_stage();

COMMENT ON FUNCTION public.enforce_recon_action_analysis_stage() IS
  'Garante que ações da conciliação (Ignorar, Revisar manualmente, Marcar como glosa, Cancelar item, Incorporar) só são registradas enquanto o pagamento está na etapa de análise. Bloqueia mistura com o fluxo de NF.';