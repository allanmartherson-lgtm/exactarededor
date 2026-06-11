
-- Reset operacional para início do uso real.
-- Preserva todos os cadastros, regras, aliases, hospitais, usuários, templates e configurações.
-- Limpa: pagamentos, conciliação, glosa, IA/análise, comunicação, notificações, auditoria operacional.

BEGIN;

-- Comunicação / notificações
TRUNCATE TABLE
  public.comm_campaign_recipients,
  public.comm_campaigns,
  public.notification_deliveries,
  public.notification_queue,
  public.internal_notifications,
  public.doctor_notifications,
  public.doctor_messages,
  public.company_messages,
  public.company_threads,
  public.thread_view_log,
  public.invoice_question_attachments,
  public.invoice_questions,
  public.payment_question_reads,
  public.payment_questions,
  public.pendencia_notification_log,
  public.pendencia_routing_log,
  public.payment_director_notifications,
  public.magic_link_tokens
RESTART IDENTITY CASCADE;

-- Glosa
TRUNCATE TABLE
  public.glosa_payment_applications,
  public.glosa_item_match_history,
  public.glosa_debt_items,
  public.glosa_debts,
  public.glosa_items,
  public.glosa_batches
RESTART IDENTITY CASCADE;

-- Conciliação (runs por pagamento + retroativa + bases hospitalares)
TRUNCATE TABLE
  public.retroactive_reconciliation_items,
  public.retroactive_reconciliations,
  public.reconciliation_items,
  public.reconciliation_runs,
  public.reconciliation_company_mappings,
  public.conciliation_bases
RESTART IDENTITY CASCADE;

-- Pools / ajustes financeiros aplicados
TRUNCATE TABLE
  public.pool_deductions,
  public.pool_calculation_runs,
  public.company_adjustment_applications,
  public.company_financial_adjustments,
  public.financial_journal
RESTART IDENTITY CASCADE;

-- Notas fiscais ligadas ao ciclo
TRUNCATE TABLE public.invoices RESTART IDENTITY CASCADE;

-- IA / análise / telemetria / validações de produção
TRUNCATE TABLE
  public.ai_analysis_versions,
  public.ai_retry_queue,
  public.analysis_telemetry,
  public.analysis_dead_letter,
  public.production_validation_feedbacks,
  public.production_validations,
  public.status_anomalies,
  public.rule_calculations
RESTART IDENTITY CASCADE;

-- Pendências
TRUNCATE TABLE public.pendencias RESTART IDENTITY CASCADE;

-- Pagamentos (núcleo) — CASCADE pega items, groups, financials, observations, assignments, jobs, etc.
TRUNCATE TABLE
  public.payment_pivot_cache,
  public.payment_job_context,
  public.payment_processing_jobs,
  public.payment_unmatched_items,
  public.payment_status_history,
  public.payment_observations,
  public.payment_assignments,
  public.payment_company_financials,
  public.payment_company_groups,
  public.payment_items,
  public.payments
RESTART IDENTITY CASCADE;

-- Auditoria operacional / logs (mantemos hospital_switch_log? user pediu limpar comunicação;
-- audit/export/access são logs operacionais — limpar para começar zerado)
TRUNCATE TABLE
  public.audit_log,
  public.export_log,
  public.company_access_log,
  public.hospital_switch_log
RESTART IDENTITY CASCADE;

COMMIT;
