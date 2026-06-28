
-- 1) Remove anon short-circuit from scope functions
CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_global_role(auth.uid())
      OR (
        _hospital_id IS NOT NULL
        AND _hospital_id = ANY(public.user_hospital_ids(auth.uid()))
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.state_scope_allows(_state_uf text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_global_role(auth.uid())
      OR _state_uf IS NULL
      OR _state_uf = ANY (public.user_state_ufs(auth.uid()))
    );
$function$;

-- 2) Re-scope policies from {public} to {authenticated}
-- production_validation_feedbacks
ALTER POLICY "pvf_empresa_insert" ON public.production_validation_feedbacks TO authenticated;
ALTER POLICY "pvf_empresa_select" ON public.production_validation_feedbacks TO authenticated;
ALTER POLICY "pvf_internal_all"   ON public.production_validation_feedbacks TO authenticated;

-- production_validations
ALTER POLICY "pval_empresa_select" ON public.production_validations TO authenticated;
ALTER POLICY "pval_empresa_update" ON public.production_validations TO authenticated;
ALTER POLICY "pval_internal_all"   ON public.production_validations TO authenticated;

-- user_company_note_attachments
ALTER POLICY "own attachments delete" ON public.user_company_note_attachments TO authenticated;
ALTER POLICY "own attachments insert" ON public.user_company_note_attachments TO authenticated;
ALTER POLICY "own attachments select" ON public.user_company_note_attachments TO authenticated;
ALTER POLICY "own attachments update" ON public.user_company_note_attachments TO authenticated;

-- user_company_notes
ALTER POLICY "Users delete own notes" ON public.user_company_notes TO authenticated;
ALTER POLICY "Users insert own notes" ON public.user_company_notes TO authenticated;
ALTER POLICY "Users update own notes" ON public.user_company_notes TO authenticated;
ALTER POLICY "Users view own notes"   ON public.user_company_notes TO authenticated;

-- user_notification_settings
ALTER POLICY "Users can manage their own notification settings" ON public.user_notification_settings TO authenticated;
