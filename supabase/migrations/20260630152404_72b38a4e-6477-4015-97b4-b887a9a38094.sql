DO $mig$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
       AND p.prorettype <> 'pg_catalog.trigger'::regtype
       AND p.proname NOT IN (
         'accept_payment_item','accept_payment_item_keep_paid','apply_calc_duplicity_resolution',
         'apply_duplicate_override','apply_learned_hints_for_payment','apply_rule_save_with_corrections',
         'approve_payment','bulk_conclude_analyst_groups','bulk_send_groups_to_validation',
         'calculate_payment_audit','call_supervisor','cancel_by_reconciliation','comm_reply_on_behalf',
         'comm_thread_assign','comm_thread_close','conclude_historico_payment','delete_payment_batch',
         'engine_sources_ready','enqueue_ai_retry','enqueue_notification','enrich_doctor_documents',
         'finalize_ai_retry','finalize_confeccao','get_ai_accuracy','get_cancellation_report_detailed',
         'get_cancelled_payments_summary','get_doctors_missing_specialty','get_dre_consolidated',
         'get_dre_drilldown','get_intervention_savings','get_invoice_upload_tokens','get_money_anomalies',
         'get_money_funnel','get_open_position','get_payment_pivot','get_return_rate','get_spend_trend',
         'get_stage_dwell_time','get_stuck_companies','ignore_unmatched_items','increment_processing_progress',
         'init_engine_sources_for_payment','is_feature_enabled','link_unmatched_items_to_company',
         'list_decision_makers','list_payments','mark_all_notifications_read','mark_engine_source',
         'mark_notification_read','my_accessible_hospitals','normalize_sector','payments_global_stats',
         'payments_kpis','question_company_group','reactivate_cancelled_group','reactivate_cancelled_item',
         'recompute_payment_status_from_groups','reconcile_job_progress','repair_portal_links',
         'repair_status_inconsistencies','reply_question','resolve_system_parameter','restore_rule_from_snapshot',
         'retry_payment_recompute_failures','return_groups_to_analyst','revert_cost_center_import',
         'rule_pending_doctors','scan_all_doctor_notes','set_active_hospital','silence_learned_pattern',
         'undo_accept_payment_item','validate_rule_save'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END
$mig$;