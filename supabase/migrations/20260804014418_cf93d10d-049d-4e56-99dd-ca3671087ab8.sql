-- 1) Trigger: state_uf sempre derivado do hospital ativo
CREATE OR REPLACE FUNCTION public.enforce_state_uf_from_hospital()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_hospital uuid;
  v_uf text;
BEGIN
  IF public.is_service_role_call() THEN
    -- Chamada interna (edge function): o caller é responsável por calcular
    -- corretamente a UF a partir do hospital. Nunca gravar NULL às cegas.
    IF NEW.state_uf IS NULL OR btrim(NEW.state_uf) = '' THEN
      RAISE EXCEPTION 'state_uf obrigatorio em % para chamadas internas (derive do hospital do registro)', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_hospital := public.current_active_hospital();
  IF v_hospital IS NULL THEN
    RAISE EXCEPTION 'Nenhuma unidade ativa selecionada — nao e possivel cadastrar em %', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT upper(btrim(h.state_uf)) INTO v_uf FROM public.hospitals h WHERE h.id = v_hospital;
  IF v_uf IS NULL OR v_uf = '' THEN
    RAISE EXCEPTION 'Hospital ativo sem state_uf cadastrado' USING ERRCODE = 'check_violation';
  END IF;

  -- Ignora qualquer valor mandado pelo client.
  NEW.state_uf := v_uf;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_state_uf_from_hospital ON public.doctors;
CREATE TRIGGER enforce_state_uf_from_hospital
  BEFORE INSERT ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_state_uf_from_hospital();

DROP TRIGGER IF EXISTS enforce_state_uf_from_hospital ON public.companies;
CREATE TRIGGER enforce_state_uf_from_hospital
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_state_uf_from_hospital();

-- 2) Backfill dos 2 registros orfaos
UPDATE public.doctors   SET state_uf = 'DF' WHERE state_uf IS NULL;
UPDATE public.companies SET state_uf = 'DF' WHERE state_uf IS NULL;

ALTER TABLE public.doctors   ALTER COLUMN state_uf SET NOT NULL;
ALTER TABLE public.companies ALTER COLUMN state_uf SET NOT NULL;

-- 3) Variante estrita: NULL nao e mais passe-livre.
-- Nao alteramos public.state_scope_allows porque convenios/sectors/*_aliases
-- ainda dependem legitimamente de state_uf NULL (registros globais).
CREATE OR REPLACE FUNCTION public.state_scope_allows_strict(_state_uf text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _state_uf IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR _state_uf = ANY (public.user_state_ufs(auth.uid()))
    );
$$;

GRANT EXECUTE ON FUNCTION public.state_scope_allows_strict(text) TO authenticated, service_role;

-- 4) Politicas de doctors/companies passam a usar a variante estrita
ALTER POLICY state_scope_restrictive ON public.companies
  USING (public.state_scope_allows_strict(state_uf::text))
  WITH CHECK (public.state_scope_allows_strict(state_uf::text));

ALTER POLICY state_scope_restrictive ON public.doctors
  USING (public.state_scope_allows_strict(state_uf::text))
  WITH CHECK (public.state_scope_allows_strict(state_uf::text));

ALTER POLICY companies_insert_workflow ON public.companies
  WITH CHECK (
    (has_role(auth.uid(), 'analista'::app_role)
     OR has_role(auth.uid(), 'validador'::app_role)
     OR has_role(auth.uid(), 'diretor'::app_role)
     OR has_role(auth.uid(), 'admin'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  );

ALTER POLICY companies_manage_admin_diretor ON public.companies
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  );

ALTER POLICY doctors_manage_admin_diretor ON public.doctors
  USING (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  );

ALTER POLICY doctors_insert_pending_self ON public.doctors
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
    AND NOT is_portal_user(auth.uid())
    AND (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'analista'::app_role)
      OR has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'gestao_medica'::app_role))
    AND public.state_scope_allows_strict(state_uf::text)
  );

ALTER POLICY doctors_update_own_pending ON public.doctors
  USING (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
    AND public.state_scope_allows_strict(state_uf::text)
  )
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
    AND public.state_scope_allows_strict(state_uf::text)
  );