CREATE OR REPLACE FUNCTION public.guard_group_workflow_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_appr_src text := COALESCE(NEW.approval_source, 'system');
  v_val_src  text := COALESCE(NEW.validation_source, 'system');
  v_is_validador boolean;
  v_is_diretor boolean;
  v_is_analista boolean;
  v_ext_appr boolean;
  v_ext_val boolean;
BEGIN
  IF public.is_service_role_call() OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  v_is_validador := public.has_role(v_uid, 'validador'::public.app_role);
  v_is_diretor   := public.has_role(v_uid, 'diretor'::public.app_role);
  v_is_analista  := public.has_role(v_uid, 'analista'::public.app_role);

  -- Registro externo: o operador real precisa estar creditado em *_registered_by
  v_ext_appr := v_appr_src IN ('email','whatsapp','outro')
                AND NEW.approval_registered_by = v_uid;
  v_ext_val  := v_val_src IN ('email','whatsapp','outro')
                AND NEW.validation_registered_by = v_uid;

  IF NEW.validated_by IS DISTINCT FROM OLD.validated_by
     AND NEW.validated_by IS NOT NULL AND NEW.validated_by <> v_uid
     AND NOT v_ext_val THEN
    RAISE EXCEPTION 'Não é permitido registrar validação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> v_uid
     AND NOT v_ext_appr THEN
    RAISE EXCEPTION 'Não é permitido registrar aprovação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  IF NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
     AND NEW.rejected_by IS NOT NULL AND NEW.rejected_by <> v_uid
     AND NOT v_ext_appr THEN
    RAISE EXCEPTION 'Não é permitido registrar rejeição em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT created_by INTO v_creator FROM public.payments WHERE id = NEW.payment_id;

  IF NEW.status IN ('aguardando_aprovacao'::public.payment_status,
                    'concluido_validacao'::public.payment_status)
     AND v_val_src = 'system' THEN
    IF NOT (v_is_validador OR v_is_diretor
            OR (v_is_analista AND OLD.status = 'devolvido_analista'::public.payment_status)) THEN
      RAISE EXCEPTION 'Transição % -> % exige papel de validador.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    IF v_creator IS NOT NULL AND v_creator = v_uid
       AND NOT (v_is_analista AND OLD.status = 'devolvido_analista'::public.payment_status) THEN
      RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode validá-lo.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status IN ('aprovado'::public.payment_status,
                    'aprovado_em_revisao'::public.payment_status,
                    'aprovado_com_ressalva'::public.payment_status,
                    'aprovado_parcial'::public.payment_status,
                    'rejeitado'::public.payment_status)
     AND v_appr_src = 'system' THEN
    IF NOT v_is_diretor THEN
      RAISE EXCEPTION 'Transição % -> % exige papel de diretor.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    IF v_creator IS NOT NULL AND v_creator = v_uid THEN
      RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode aprová-lo/rejeitá-lo.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'revisao_pos_aprovacao'::public.payment_status
     AND v_appr_src = 'system'
     AND NOT v_is_diretor THEN
    RAISE EXCEPTION 'Transição % -> revisao_pos_aprovacao exige papel de diretor ou registro de aprovação externa.', OLD.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;