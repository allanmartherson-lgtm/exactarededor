-- Reescreve guard_group_workflow_transition() com duas mudanças:
--
-- 1) FIX DE SEGURANÇA: o gate de papel (validador/diretor) só era aplicado
--    quando approval_source/validation_source = 'system'. Como essas
--    colunas são graváveis por qualquer um dos 4 papéis via RLS normal
--    (pcg_manage_workflow) e só têm CHECK de valores permitidos
--    ('system'|'magic_link'|'email'|'whatsapp'|'outro'), um analista podia
--    se auto-aprovar enviando approval_source='outro' junto com
--    status='aprovado'/'revisao_pos_aprovacao' no mesmo UPDATE, pulando o
--    gate inteiro. A condição "fonte != system" é substituída por um GUC
--    (app.allow_external_workflow_write) que só register_external_approval/
--    register_external_validation sabem setar — não é algo que o client
--    consiga forjar via .update() comum, diferente das colunas de origem.
--
--    NOTA: uma versão concorrente desta função (migration
--    ..._020544_ff9cd082-...sql, "Abriu exceção no trigger RPC") corrigiu
--    apenas o falso-positivo do check de spoof para o recurso p_decisor_id
--    (approved_by podendo ser um decisor diferente do operador), mas manteve
--    a condição "v_appr_src/v_val_src = 'system'" no gate de papel — ou
--    seja, o bypass do achado A CONTINUA aberto naquela versão. Esta
--    migration substitui a função inteira e corrige os dois problemas juntos
--    (o do achado A e o do p_decisor_id): o GUC precisa ser checado ANTES
--    dos checks de spoof também, senão register_external_approval com
--    p_decisor_id diferente do operador volta a ser bloqueado por engano.
--
-- 2) NOVO GATE: revisao_pos_aprovacao -> pedido_nf_enviado agora exige papel
--    de analista (ou admin). Confirmado com o time: depois que o diretor
--    aprova, o lote volta para o analista revisar o pedido de nota fiscal e
--    disparar — não é uma etapa livre para qualquer papel. Antes desta
--    migration, a fase de NF inteira não tinha nenhuma checagem de papel na
--    trigger (só as RPCs de aprovação/validação eram protegidas).
CREATE OR REPLACE FUNCTION public.guard_group_workflow_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_is_external_write boolean := COALESCE(current_setting('app.allow_external_workflow_write', true), '') = 'on';
  v_is_validador boolean;
  v_is_diretor boolean;
  v_is_analista boolean;
BEGIN
  IF public.is_service_role_call() OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Caminho legítimo de aprovação/validação "fora do sistema": as RPCs já
  -- validaram o papel do ator antes de chegar aqui e setam este GUC só ao
  -- redor do próprio UPDATE — inclusive quando p_decisor_id credita
  -- approved_by/validated_by a alguém diferente do operador (v_uid), o que
  -- é esperado nesse fluxo e não deve disparar o check de spoof abaixo.
  -- Por isso este check vem ANTES dos checks de spoof, não só do gate de papel.
  IF v_is_external_write THEN
    RETURN NEW;
  END IF;

  v_is_validador := public.has_role(v_uid, 'validador'::public.app_role);
  v_is_diretor   := public.has_role(v_uid, 'diretor'::public.app_role);
  v_is_analista  := public.has_role(v_uid, 'analista'::public.app_role);

  IF NEW.validated_by IS DISTINCT FROM OLD.validated_by
     AND NEW.validated_by IS NOT NULL AND NEW.validated_by <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar validação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar aprovação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  IF NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
     AND NEW.rejected_by IS NOT NULL AND NEW.rejected_by <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar rejeição em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT created_by INTO v_creator FROM public.payments WHERE id = NEW.payment_id;

  IF NEW.status IN ('aguardando_aprovacao'::public.payment_status,
                    'concluido_validacao'::public.payment_status) THEN
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
                    'rejeitado'::public.payment_status) THEN
    IF NOT v_is_diretor THEN
      RAISE EXCEPTION 'Transição % -> % exige papel de diretor.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    IF v_creator IS NOT NULL AND v_creator = v_uid THEN
      RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode aprová-lo/rejeitá-lo.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'revisao_pos_aprovacao'::public.payment_status
     AND NOT v_is_diretor THEN
    RAISE EXCEPTION 'Transição % -> revisao_pos_aprovacao exige papel de diretor ou registro de aprovação externa.', OLD.status
      USING ERRCODE = '42501';
  END IF;

  -- Pós-aprovação: só o analista (ou admin) dispara o pedido de nota fiscal.
  -- Confirma o handoff diretor -> analista antes de acionar a clínica/empresa.
  IF OLD.status = 'revisao_pos_aprovacao'::public.payment_status
     AND NEW.status = 'pedido_nf_enviado'::public.payment_status
     AND NOT v_is_analista THEN
    RAISE EXCEPTION 'Encaminhar pedido de nota fiscal exige papel de analista.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
