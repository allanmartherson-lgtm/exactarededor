-- Atualizar a função de trava de imutabilidade para aceitar o bypass
CREATE OR REPLACE FUNCTION public.guard_archived_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  allow text;
BEGIN
  -- Verificar se há um bypass ativo para manutenção/exclusão do sistema
  allow := current_setting('app.allow_payment_status_write', true);
  IF allow = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'arquivado' THEN
    RAISE EXCEPTION 'Lote arquivado é imutável (somente leitura). Alteração bloqueada.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'arquivado' THEN
    RAISE EXCEPTION 'Lote arquivado não pode ser excluído.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;