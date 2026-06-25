-- 1) Security Definer Views → forçar security_invoker nas 3 ainda 'unset'
ALTER VIEW public.portal_links_health SET (security_invoker = on);
ALTER VIEW public.v_payments_flow_scope SET (security_invoker = on);
ALTER VIEW public.vw_group_rule_totals SET (security_invoker = on);

-- 2) Function Search Path Mutable → SET search_path = public nas 13 funções user-owned
ALTER FUNCTION public.calculate_payment_audit(uuid) SET search_path = public;
ALTER FUNCTION public.delete_payment_batch(uuid) SET search_path = public;
ALTER FUNCTION public.financial_journal_block_mutation() SET search_path = public;
ALTER FUNCTION public.fix_specialties_array(text[]) SET search_path = public;
ALTER FUNCTION public.guard_archived_immutable() SET search_path = public;
ALTER FUNCTION public.increment_processing_progress(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.invalidate_pivot_cache() SET search_path = public;
ALTER FUNCTION public.is_valid_status_transition(payment_status, payment_status) SET search_path = public;
ALTER FUNCTION public.retain_latest_ai_analysis_version() SET search_path = public;
ALTER FUNCTION public.tg_rules_block_delete() SET search_path = public;
ALTER FUNCTION public.tg_rules_protect_immutable() SET search_path = public;
ALTER FUNCTION public.trg_block_archive_conciliation() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;