export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_request_attempts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip_hash: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip_hash?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip_hash?: string | null
        }
        Relationships: []
      }
      access_requests: {
        Row: {
          birth_date: string
          created_at: string
          department: string
          email: string
          full_name: string
          hospital_id: string | null
          id: string
          message: string | null
          phone: string
          rejection_reason: string | null
          requested_roles: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          role_title: string
          status: string
          updated_at: string
        }
        Insert: {
          birth_date: string
          created_at?: string
          department: string
          email: string
          full_name: string
          hospital_id?: string | null
          id?: string
          message?: string | null
          phone: string
          rejection_reason?: string | null
          requested_roles?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_title: string
          status?: string
          updated_at?: string
        }
        Update: {
          birth_date?: string
          created_at?: string
          department?: string
          email?: string
          full_name?: string
          hospital_id?: string | null
          id?: string
          message?: string | null
          phone?: string
          rejection_reason?: string | null
          requested_roles?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_title?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_analysis_versions: {
        Row: {
          ai_status: string
          alerts: Json
          calculation_explanation: string | null
          created_at: string
          expected_amount: number | null
          gross_amount_at_time: number | null
          hospital_id: string
          id: string
          item_id: string
          matched_rule_ids: Json
          matched_rules: Json
          model: string | null
          payment_id: string
          triggered_by: string | null
          version: number
        }
        Insert: {
          ai_status: string
          alerts?: Json
          calculation_explanation?: string | null
          created_at?: string
          expected_amount?: number | null
          gross_amount_at_time?: number | null
          hospital_id: string
          id?: string
          item_id: string
          matched_rule_ids?: Json
          matched_rules?: Json
          model?: string | null
          payment_id: string
          triggered_by?: string | null
          version: number
        }
        Update: {
          ai_status?: string
          alerts?: Json
          calculation_explanation?: string | null
          created_at?: string
          expected_amount?: number | null
          gross_amount_at_time?: number | null
          hospital_id?: string
          id?: string
          item_id?: string
          matched_rule_ids?: Json
          matched_rules?: Json
          model?: string | null
          payment_id?: string
          triggered_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_analysis_versions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analysis_versions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "ai_analysis_versions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analysis_versions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      ai_retry_queue: {
        Row: {
          attempts: number
          company_name: string
          created_at: string
          finished_at: string | null
          hospital_id: string
          id: string
          last_error: string | null
          last_job_id: string | null
          locked_at: string | null
          max_attempts: number
          next_attempt_at: string
          payment_id: string
          source_job_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_name: string
          created_at?: string
          finished_at?: string | null
          hospital_id: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payment_id: string
          source_job_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_name?: string
          created_at?: string
          finished_at?: string | null
          hospital_id?: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          locked_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payment_id?: string
          source_job_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      analysis_dead_letter: {
        Row: {
          attempts: number
          company_name: string
          created_at: string
          errors: Json
          hospital_id: string
          id: string
          last_error: string | null
          last_job_id: string | null
          payment_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_name: string
          created_at?: string
          errors?: Json
          hospital_id: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          payment_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_name?: string
          created_at?: string
          errors?: Json
          hospital_id?: string
          id?: string
          last_error?: string | null
          last_job_id?: string | null
          payment_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_dead_letter_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_telemetry: {
        Row: {
          ai_items_count: number
          ai_items_skipped_cache: number
          ai_ms: number
          cache_hit: boolean
          company_name: string | null
          created_at: string
          error: string | null
          hospital_id: string
          id: string
          items_count: number
          job_id: string | null
          payment_id: string
          rules_ms: number
          total_ms: number
          writes_ms: number
        }
        Insert: {
          ai_items_count?: number
          ai_items_skipped_cache?: number
          ai_ms?: number
          cache_hit?: boolean
          company_name?: string | null
          created_at?: string
          error?: string | null
          hospital_id: string
          id?: string
          items_count?: number
          job_id?: string | null
          payment_id: string
          rules_ms?: number
          total_ms?: number
          writes_ms?: number
        }
        Update: {
          ai_items_count?: number
          ai_items_skipped_cache?: number
          ai_ms?: number
          cache_hit?: boolean
          company_name?: string | null
          created_at?: string
          error?: string | null
          hospital_id?: string
          id?: string
          items_count?: number
          job_id?: string | null
          payment_id?: string
          rules_ms?: number
          total_ms?: number
          writes_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "analysis_telemetry_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      assistance_groups: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          specialties: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          specialties?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          specialties?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          company_document: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          diff: Json
          entity_id: string
          entity_type: string
          hospital_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_document?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          diff?: Json
          entity_id: string
          entity_type: string
          hospital_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_document?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string
          entity_type?: string
          hospital_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      aurum_margem_medico: {
        Row: {
          ano: number
          carater: string
          created_at: string
          custo_exames_img: number | null
          custo_hm: number | null
          custo_laboratorio: number | null
          custo_mat_med: number | null
          custo_opme: number | null
          custo_total: number | null
          dias: number | null
          faturado: boolean
          glosa_externa: number | null
          hospital_id: string
          id: string
          impostos: number | null
          margem: number | null
          margem_dia: number | null
          medico_cirurgiao: string
          pct_margem: number | null
          periodo_internacao: string
          qtd_cirurgias: number | null
          receita: number | null
          receita_liquida: number | null
          updated_at: string
        }
        Insert: {
          ano: number
          carater?: string
          created_at?: string
          custo_exames_img?: number | null
          custo_hm?: number | null
          custo_laboratorio?: number | null
          custo_mat_med?: number | null
          custo_opme?: number | null
          custo_total?: number | null
          dias?: number | null
          faturado?: boolean
          glosa_externa?: number | null
          hospital_id: string
          id?: string
          impostos?: number | null
          margem?: number | null
          margem_dia?: number | null
          medico_cirurgiao: string
          pct_margem?: number | null
          periodo_internacao?: string
          qtd_cirurgias?: number | null
          receita?: number | null
          receita_liquida?: number | null
          updated_at?: string
        }
        Update: {
          ano?: number
          carater?: string
          created_at?: string
          custo_exames_img?: number | null
          custo_hm?: number | null
          custo_laboratorio?: number | null
          custo_mat_med?: number | null
          custo_opme?: number | null
          custo_total?: number | null
          dias?: number | null
          faturado?: boolean
          glosa_externa?: number | null
          hospital_id?: string
          id?: string
          impostos?: number | null
          margem?: number | null
          margem_dia?: number | null
          medico_cirurgiao?: string
          pct_margem?: number | null
          periodo_internacao?: string
          qtd_cirurgias?: number | null
          receita?: number | null
          receita_liquida?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aurum_margem_medico_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      aurum_margem_procedimento: {
        Row: {
          ano: number
          carater: string
          created_at: string
          custo_exames_img: number | null
          custo_hm: number | null
          custo_laboratorio: number | null
          custo_mat_med: number | null
          custo_opme: number | null
          custo_total: number | null
          dias: number | null
          ds_procedimento: string
          faturado: boolean
          glosa_externa: number | null
          hospital_id: string
          id: string
          impostos: number | null
          margem: number | null
          margem_dia: number | null
          pct_margem: number | null
          periodo_internacao: string
          qtd_cirurgias: number | null
          receita: number | null
          receita_liquida: number | null
          updated_at: string
        }
        Insert: {
          ano: number
          carater?: string
          created_at?: string
          custo_exames_img?: number | null
          custo_hm?: number | null
          custo_laboratorio?: number | null
          custo_mat_med?: number | null
          custo_opme?: number | null
          custo_total?: number | null
          dias?: number | null
          ds_procedimento: string
          faturado?: boolean
          glosa_externa?: number | null
          hospital_id: string
          id?: string
          impostos?: number | null
          margem?: number | null
          margem_dia?: number | null
          pct_margem?: number | null
          periodo_internacao?: string
          qtd_cirurgias?: number | null
          receita?: number | null
          receita_liquida?: number | null
          updated_at?: string
        }
        Update: {
          ano?: number
          carater?: string
          created_at?: string
          custo_exames_img?: number | null
          custo_hm?: number | null
          custo_laboratorio?: number | null
          custo_mat_med?: number | null
          custo_opme?: number | null
          custo_total?: number | null
          dias?: number | null
          ds_procedimento?: string
          faturado?: boolean
          glosa_externa?: number | null
          hospital_id?: string
          id?: string
          impostos?: number | null
          margem?: number | null
          margem_dia?: number | null
          pct_margem?: number | null
          periodo_internacao?: string
          qtd_cirurgias?: number | null
          receita?: number | null
          receita_liquida?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aurum_margem_procedimento_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          email_error: string | null
          email_sent_at: string | null
          email_snapshot: string | null
          email_status: string | null
          id: string
          name_snapshot: string | null
          phone_snapshot: string | null
          portal_read_at: string | null
          target_id: string
          target_type: string
          whatsapp_error: string | null
          whatsapp_sent_at: string | null
          whatsapp_status: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email_error?: string | null
          email_sent_at?: string | null
          email_snapshot?: string | null
          email_status?: string | null
          id?: string
          name_snapshot?: string | null
          phone_snapshot?: string | null
          portal_read_at?: string | null
          target_id: string
          target_type: string
          whatsapp_error?: string | null
          whatsapp_sent_at?: string | null
          whatsapp_status?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email_error?: string | null
          email_sent_at?: string | null
          email_snapshot?: string | null
          email_status?: string | null
          id?: string
          name_snapshot?: string | null
          phone_snapshot?: string | null
          portal_read_at?: string | null
          target_id?: string
          target_type?: string
          whatsapp_error?: string | null
          whatsapp_sent_at?: string | null
          whatsapp_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_campaigns: {
        Row: {
          allow_reply: boolean
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          audience: Json
          channels: string[]
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          hospital_id: string
          id: string
          message: string
          rejection_reason: string | null
          scheduled_for: string | null
          status: string
          title: string
          totals: Json
          updated_at: string
        }
        Insert: {
          allow_reply?: boolean
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience?: Json
          channels?: string[]
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          hospital_id: string
          id?: string
          message: string
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string
          title: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          allow_reply?: boolean
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience?: Json
          channels?: string[]
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          hospital_id?: string
          id?: string
          message?: string
          rejection_reason?: string | null
          scheduled_for?: string | null
          status?: string
          title?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      communication_sla_settings: {
        Row: {
          active: boolean
          channel: string
          created_at: string
          first_response_hours: number
          hospital_id: string | null
          id: string
          resolution_hours: number
          severity: string
          updated_at: string
          warning_pct: number
        }
        Insert: {
          active?: boolean
          channel: string
          created_at?: string
          first_response_hours?: number
          hospital_id?: string | null
          id?: string
          resolution_hours?: number
          severity?: string
          updated_at?: string
          warning_pct?: number
        }
        Update: {
          active?: boolean
          channel?: string
          created_at?: string
          first_response_hours?: number
          hospital_id?: string | null
          id?: string
          resolution_hours?: number
          severity?: string
          updated_at?: string
          warning_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "communication_sla_settings_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          aliases: string[]
          code: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          default_item_type_id: string | null
          document: string | null
          id: string
          invoice_emails: string[]
          name: string
          notes: string | null
          state_uf: string | null
          tem_pool: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          code?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          default_item_type_id?: string | null
          document?: string | null
          id?: string
          invoice_emails?: string[]
          name: string
          notes?: string | null
          state_uf?: string | null
          tem_pool?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          code?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          default_item_type_id?: string | null
          document?: string | null
          id?: string
          invoice_emails?: string[]
          name?: string
          notes?: string | null
          state_uf?: string | null
          tem_pool?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_default_item_type_id_fkey"
            columns: ["default_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      company_access_log: {
        Row: {
          company_id: string
          created_at: string
          hospital_id: string | null
          id: string
          resource: string
          resource_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          resource: string
          resource_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          resource?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_access_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_access_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_adjustment_applications: {
        Row: {
          adjustment_id: string
          applied_at: string
          applied_by: string | null
          company_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          hospital_id: string
          id: string
          parcela_numero: number
          payment_id: string
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          source: string
          status: string
          valor_aplicado: number
        }
        Insert: {
          adjustment_id: string
          applied_at?: string
          applied_by?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          hospital_id: string
          id?: string
          parcela_numero: number
          payment_id: string
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          source?: string
          status?: string
          valor_aplicado: number
        }
        Update: {
          adjustment_id?: string
          applied_at?: string
          applied_by?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          hospital_id?: string
          id?: string
          parcela_numero?: number
          payment_id?: string
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          source?: string
          status?: string
          valor_aplicado?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_adjustment_applications_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "company_financial_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_adjustment_applications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_attachments: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          hospital_id: string
          id: string
          message_id: string | null
          mime_type: string
          pendencia_id: string | null
          size_bytes: number
          storage_path: string
          uploaded_by_type: string
          uploaded_by_user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          file_name: string
          hospital_id: string
          id?: string
          message_id?: string | null
          mime_type: string
          pendencia_id?: string | null
          size_bytes: number
          storage_path: string
          uploaded_by_type?: string
          uploaded_by_user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          hospital_id?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          pendencia_id?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_by_type?: string
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_attachments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "company_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_attachments_pendencia_id_fkey"
            columns: ["pendencia_id"]
            isOneToOne: false
            referencedRelation: "pendencias"
            referencedColumns: ["id"]
          },
        ]
      }
      company_financial_adjustments: {
        Row: {
          ativo: boolean
          company_id: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          data_fim: string | null
          data_inicio: string
          descricao: string
          hospital_id: string
          id: string
          origem: string | null
          parcelas_pagas: number
          parcelas_total: number
          payment_model_ids: string[] | null
          recorrente: boolean
          tipo: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          ativo?: boolean
          company_id: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          data_fim?: string | null
          data_inicio?: string
          descricao: string
          hospital_id: string
          id?: string
          origem?: string | null
          parcelas_pagas?: number
          parcelas_total?: number
          payment_model_ids?: string[] | null
          recorrente?: boolean
          tipo: string
          updated_at?: string
          valor_total: number
        }
        Update: {
          ativo?: boolean
          company_id?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          data_fim?: string | null
          data_inicio?: string
          descricao?: string
          hospital_id?: string
          id?: string
          origem?: string | null
          parcelas_pagas?: number
          parcelas_total?: number
          payment_model_ids?: string[] | null
          recorrente?: boolean
          tipo?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_financial_adjustments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_financial_adjustments_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_financial_adjustments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_group_approvals: {
        Row: {
          approval_source: string
          approved_at: string
          approved_by: string | null
          approved_on_behalf_of: string | null
          bruto_total: number
          company_id: string | null
          created_at: string
          external_evidence_path: string | null
          external_note: string | null
          hospital_id: string
          id: string
          items_snapshot: Json | null
          liquido_total: number
          magic_link_token_id: string | null
          payment_company_group_id: string
          pdf_url: string | null
          reason: string | null
          registered_by: string | null
          superseded_at: string | null
          superseded_by_version: number | null
          version: number
        }
        Insert: {
          approval_source?: string
          approved_at?: string
          approved_by?: string | null
          approved_on_behalf_of?: string | null
          bruto_total?: number
          company_id?: string | null
          created_at?: string
          external_evidence_path?: string | null
          external_note?: string | null
          hospital_id: string
          id?: string
          items_snapshot?: Json | null
          liquido_total?: number
          magic_link_token_id?: string | null
          payment_company_group_id: string
          pdf_url?: string | null
          reason?: string | null
          registered_by?: string | null
          superseded_at?: string | null
          superseded_by_version?: number | null
          version: number
        }
        Update: {
          approval_source?: string
          approved_at?: string
          approved_by?: string | null
          approved_on_behalf_of?: string | null
          bruto_total?: number
          company_id?: string | null
          created_at?: string
          external_evidence_path?: string | null
          external_note?: string | null
          hospital_id?: string
          id?: string
          items_snapshot?: Json | null
          liquido_total?: number
          magic_link_token_id?: string | null
          payment_company_group_id?: string
          pdf_url?: string | null
          reason?: string | null
          registered_by?: string | null
          superseded_at?: string | null
          superseded_by_version?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_group_approvals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_group_approvals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_group_approvals_payment_company_group_id_fkey"
            columns: ["payment_company_group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_group_approvals_payment_company_group_id_fkey"
            columns: ["payment_company_group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
        ]
      }
      company_hospital_overrides: {
        Row: {
          company_id: string
          created_at: string
          hospital_id: string
          override_data: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          hospital_id: string
          override_data?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          hospital_id?: string
          override_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_hospital_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_hospital_overrides_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_link_suggestions: {
        Row: {
          ai_reasoning: string | null
          company_id: string | null
          confidence: string | null
          context_jsonb: Json | null
          created_at: string
          detected_value: string | null
          detected_value_normalized: string | null
          id: string
          matched_company_id: string | null
          raw_snippet: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number | null
          source: string
          source_field: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          company_id?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_company_id?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          company_id?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_company_id?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_link_suggestions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_link_suggestions_matched_company_id_fkey"
            columns: ["matched_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_messages: {
        Row: {
          author_name: string
          author_type: string
          author_user_id: string | null
          company_id: string
          created_at: string
          hospital_id: string
          id: string
          message: string
          read_by_company_at: string | null
          read_by_internal_at: string | null
          thread_id: string
        }
        Insert: {
          author_name: string
          author_type: string
          author_user_id?: string | null
          company_id: string
          created_at?: string
          hospital_id: string
          id?: string
          message: string
          read_by_company_at?: string | null
          read_by_internal_at?: string | null
          thread_id: string
        }
        Update: {
          author_name?: string
          author_type?: string
          author_user_id?: string | null
          company_id?: string
          created_at?: string
          hospital_id?: string
          id?: string
          message?: string
          read_by_company_at?: string | null
          read_by_internal_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_messages_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "company_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      company_portal_user_hospitals: {
        Row: {
          created_at: string
          hospital_id: string
          id: string
          is_primary: boolean
          portal_user_id: string
        }
        Insert: {
          created_at?: string
          hospital_id: string
          id?: string
          is_primary?: boolean
          portal_user_id: string
        }
        Update: {
          created_at?: string
          hospital_id?: string
          id?: string
          is_primary?: boolean
          portal_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_portal_user_hospitals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_portal_user_hospitals_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "company_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      company_portal_users: {
        Row: {
          accepted_at: string | null
          active: boolean
          company_id: string
          created_at: string
          email: string | null
          id: string
          invited_at: string
          invited_by: string | null
          link_health: Database["public"]["Enums"]["portal_link_health"]
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          active?: boolean
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          link_health?: Database["public"]["Enums"]["portal_link_health"]
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          active?: boolean
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          link_health?: Database["public"]["Enums"]["portal_link_health"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_portal_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_portal_users_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sla_overrides: {
        Row: {
          company_id: string
          created_at: string
          due_day: number | null
          due_offset_days: number | null
          due_rule: string
          hospital_id: string
          id: string
          inherit_default: boolean
          notes: string | null
          priority: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          due_day?: number | null
          due_offset_days?: number | null
          due_rule?: string
          hospital_id: string
          id?: string
          inherit_default?: boolean
          notes?: string | null
          priority?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          due_day?: number | null
          due_offset_days?: number | null
          due_rule?: string
          hospital_id?: string
          id?: string
          inherit_default?: boolean
          notes?: string | null
          priority?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_sla_overrides_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_threads: {
        Row: {
          campaign_id: string | null
          company_id: string
          created_at: string
          created_by_type: string
          created_by_user_id: string | null
          hospital_id: string
          id: string
          invoice_id: string | null
          last_message_at: string
          last_message_preview: string | null
          payment_id: string | null
          scope: string
          source: string | null
          status: string
          subject: string
          unread_for_company: number
          unread_for_internal: number
        }
        Insert: {
          campaign_id?: string | null
          company_id: string
          created_at?: string
          created_by_type: string
          created_by_user_id?: string | null
          hospital_id: string
          id?: string
          invoice_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          payment_id?: string | null
          scope: string
          source?: string | null
          status?: string
          subject: string
          unread_for_company?: number
          unread_for_internal?: number
        }
        Update: {
          campaign_id?: string | null
          company_id?: string
          created_at?: string
          created_by_type?: string
          created_by_user_id?: string | null
          hospital_id?: string
          id?: string
          invoice_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          payment_id?: string | null
          scope?: string
          source?: string | null
          status?: string
          subject?: string
          unread_for_company?: number
          unread_for_internal?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_threads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_threads_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_threads_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_threads_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "company_threads_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_threads_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      conciliation_bases: {
        Row: {
          base_anterior_id: string | null
          col_map: Json | null
          competence_month: string | null
          created_at: string | null
          file_name: string | null
          hospital_id: string
          id: string
          raw_data: Json | null
          reference: string
          sheet_name: string | null
          status: string
          tem_itens_aplicados: boolean | null
          total_rows: number | null
          uploaded_at: string | null
          uploaded_by: string | null
          versao: number | null
        }
        Insert: {
          base_anterior_id?: string | null
          col_map?: Json | null
          competence_month?: string | null
          created_at?: string | null
          file_name?: string | null
          hospital_id: string
          id?: string
          raw_data?: Json | null
          reference: string
          sheet_name?: string | null
          status?: string
          tem_itens_aplicados?: boolean | null
          total_rows?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          versao?: number | null
        }
        Update: {
          base_anterior_id?: string | null
          col_map?: Json | null
          competence_month?: string | null
          created_at?: string | null
          file_name?: string | null
          hospital_id?: string
          id?: string
          raw_data?: Json | null
          reference?: string
          sheet_name?: string | null
          status?: string
          tem_itens_aplicados?: boolean | null
          total_rows?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliation_bases_base_anterior_id_fkey"
            columns: ["base_anterior_id"]
            isOneToOne: false
            referencedRelation: "conciliation_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliation_bases_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      convenio_aliases: {
        Row: {
          alias_normalized: string | null
          alias_text: string
          convenio_slug: string
          created_at: string
          created_by: string | null
          hospital_id: string | null
          id: string
          source: string
          state_uf: string | null
        }
        Insert: {
          alias_normalized?: string | null
          alias_text: string
          convenio_slug: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string | null
          id?: string
          source?: string
          state_uf?: string | null
        }
        Update: {
          alias_normalized?: string | null
          alias_text?: string
          convenio_slug?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string | null
          id?: string
          source?: string
          state_uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "convenio_aliases_convenio_slug_fkey"
            columns: ["convenio_slug"]
            isOneToOne: false
            referencedRelation: "convenios"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "convenio_aliases_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      convenio_link_suggestions: {
        Row: {
          ai_reasoning: string | null
          confidence: string | null
          context_jsonb: Json | null
          convenio_slug: string | null
          created_at: string
          detected_value: string | null
          detected_value_normalized: string | null
          id: string
          matched_convenio_slug: string | null
          raw_snippet: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number | null
          source: string
          source_field: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          convenio_slug?: string | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_convenio_slug?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          convenio_slug?: string | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_convenio_slug?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      convenios: {
        Row: {
          active: boolean
          aliases: string[]
          code: string
          created_at: string
          created_by_user_id: string | null
          deactivated_at: string | null
          hospital_id: string | null
          name: string
          notes: string | null
          operator_code: string | null
          pending_admin_review: boolean
          pending_review_note: string | null
          slug: string
          sort_order: number
          state_uf: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          deactivated_at?: string | null
          hospital_id?: string | null
          name: string
          notes?: string | null
          operator_code?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          slug: string
          sort_order?: number
          state_uf?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          deactivated_at?: string | null
          hospital_id?: string | null
          name?: string
          notes?: string | null
          operator_code?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          slug?: string
          sort_order?: number
          state_uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "convenios_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_center_imports: {
        Row: {
          created_count: number
          deactivated_count: number
          file_name: string | null
          hospital_id: string
          id: string
          imported_at: string
          imported_by: string
          reverted_at: string | null
          reverted_by: string | null
          rows_in_file: number
          snapshot: Json
          status: string
          updated_count: number
        }
        Insert: {
          created_count?: number
          deactivated_count?: number
          file_name?: string | null
          hospital_id: string
          id?: string
          imported_at?: string
          imported_by: string
          reverted_at?: string | null
          reverted_by?: string | null
          rows_in_file?: number
          snapshot: Json
          status?: string
          updated_count?: number
        }
        Update: {
          created_count?: number
          deactivated_count?: number
          file_name?: string | null
          hospital_id?: string
          id?: string
          imported_at?: string
          imported_by?: string
          reverted_at?: string | null
          reverted_by?: string | null
          rows_in_file?: number
          snapshot?: Json
          status?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_imports_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          active: boolean
          code: string
          code_p10: string | null
          code_p12: string
          code_pai: string | null
          created_at: string
          deactivated_at: string | null
          hospital_id: string | null
          id: string
          imported_at: string
          imported_by: string | null
          level1: string | null
          level2: string | null
          level3: string | null
          level4: string | null
          level5: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code?: string
          code_p10?: string | null
          code_p12: string
          code_pai?: string | null
          created_at?: string
          deactivated_at?: string | null
          hospital_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          level1?: string | null
          level2?: string | null
          level3?: string | null
          level4?: string | null
          level5?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          code_p10?: string | null
          code_p12?: string
          code_pai?: string | null
          created_at?: string
          deactivated_at?: string | null
          hospital_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          level1?: string | null
          level2?: string | null
          level3?: string | null
          level4?: string | null
          level5?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      deduction_application_events: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          debt_id: string | null
          hospital_id: string | null
          id: string
          metadata: Json
          payment_id: string | null
          reason: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          debt_id?: string | null
          hospital_id?: string | null
          id?: string
          metadata?: Json
          payment_id?: string | null
          reason?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          debt_id?: string | null
          hospital_id?: string | null
          id?: string
          metadata?: Json
          payment_id?: string | null
          reason?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      deduction_run_locks: {
        Row: {
          company_id: string
          expires_at: string
          hospital_id: string | null
          payment_id: string
          started_at: string
        }
        Insert: {
          company_id: string
          expires_at?: string
          hospital_id?: string | null
          payment_id: string
          started_at?: string
        }
        Update: {
          company_id?: string
          expires_at?: string
          hospital_id?: string | null
          payment_id?: string
          started_at?: string
        }
        Relationships: []
      }
      doctor_aliases: {
        Row: {
          alias_normalized: string | null
          alias_text: string
          created_at: string
          created_by: string | null
          doctor_id: string
          id: string
          source: string
          state_uf: string | null
        }
        Insert: {
          alias_normalized?: string | null
          alias_text: string
          created_at?: string
          created_by?: string | null
          doctor_id: string
          id?: string
          source?: string
          state_uf?: string | null
        }
        Update: {
          alias_normalized?: string | null
          alias_text?: string
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          id?: string
          source?: string
          state_uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_aliases_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_companies: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          doctor_id: string
          end_date: string | null
          end_reason: string | null
          hospital_id: string
          id: string
          start_date: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          doctor_id: string
          end_date?: string | null
          end_reason?: string | null
          hospital_id: string
          id?: string
          start_date?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          end_date?: string | null
          end_reason?: string | null
          hospital_id?: string
          id?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_companies_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_companies_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_hospital_overrides: {
        Row: {
          created_at: string
          doctor_id: string
          hospital_id: string
          override_data: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          hospital_id: string
          override_data?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          hospital_id?: string
          override_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_hospital_overrides_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_hospital_overrides_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_link_suggestions: {
        Row: {
          ai_reasoning: string | null
          auto_resolution: string | null
          confidence: string | null
          context_jsonb: Json | null
          created_at: string
          detected_kind: string
          detected_value: string
          detected_value_normalized: string
          doctor_id: string
          id: string
          matched_company_id: string | null
          matched_doctor_id: string | null
          raw_snippet: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number | null
          source: string
          source_field: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          auto_resolution?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_kind: string
          detected_value: string
          detected_value_normalized: string
          doctor_id: string
          id?: string
          matched_company_id?: string | null
          matched_doctor_id?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          auto_resolution?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_kind?: string
          detected_value?: string
          detected_value_normalized?: string
          doctor_id?: string
          id?: string
          matched_company_id?: string | null
          matched_doctor_id?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          source?: string
          source_field?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_link_suggestions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_link_suggestions_matched_company_id_fkey"
            columns: ["matched_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_link_suggestions_matched_doctor_id_fkey"
            columns: ["matched_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_messages: {
        Row: {
          assigned_to: string | null
          author_name: string
          author_type: string
          author_user_id: string | null
          campaign_id: string | null
          created_at: string
          doctor_id: string
          first_response_at: string | null
          hospital_id: string
          id: string
          message: string
          payment_id: string | null
          payment_item_id: string | null
          read_at: string | null
          read_by_doctor_at: string | null
          responded_at: string | null
          sla_alerted_at: string | null
          status: string
          thread_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          author_name: string
          author_type: string
          author_user_id?: string | null
          campaign_id?: string | null
          created_at?: string
          doctor_id: string
          first_response_at?: string | null
          hospital_id: string
          id?: string
          message: string
          payment_id?: string | null
          payment_item_id?: string | null
          read_at?: string | null
          read_by_doctor_at?: string | null
          responded_at?: string | null
          sla_alerted_at?: string | null
          status?: string
          thread_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          author_name?: string
          author_type?: string
          author_user_id?: string | null
          campaign_id?: string | null
          created_at?: string
          doctor_id?: string
          first_response_at?: string | null
          hospital_id?: string
          id?: string
          message?: string
          payment_id?: string | null
          payment_item_id?: string | null
          read_at?: string | null
          read_by_doctor_at?: string | null
          responded_at?: string | null
          sla_alerted_at?: string | null
          status?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "doctor_messages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "doctor_messages_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_messages_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
        ]
      }
      doctor_notification_preferences: {
        Row: {
          doctor_id: string
          email_enabled: boolean
          notify_new_message: boolean
          notify_new_payment: boolean
          notify_status_change: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          doctor_id: string
          email_enabled?: boolean
          notify_new_message?: boolean
          notify_new_payment?: boolean
          notify_status_change?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          doctor_id?: string
          email_enabled?: boolean
          notify_new_message?: boolean
          notify_new_payment?: boolean
          notify_status_change?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      doctor_notifications: {
        Row: {
          body: string | null
          created_at: string
          doctor_id: string
          hospital_id: string
          id: string
          link_path: string | null
          payment_id: string | null
          payment_item_id: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          doctor_id: string
          hospital_id: string
          id?: string
          link_path?: string | null
          payment_id?: string | null
          payment_item_id?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          doctor_id?: string
          hospital_id?: string
          id?: string
          link_path?: string | null
          payment_id?: string | null
          payment_item_id?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_notifications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_portal_user_hospitals: {
        Row: {
          created_at: string
          hospital_id: string
          id: string
          is_primary: boolean
          portal_user_id: string
        }
        Insert: {
          created_at?: string
          hospital_id: string
          id?: string
          is_primary?: boolean
          portal_user_id: string
        }
        Update: {
          created_at?: string
          hospital_id?: string
          id?: string
          is_primary?: boolean
          portal_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_portal_user_hospitals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_portal_user_hospitals_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "doctor_portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_portal_users: {
        Row: {
          accepted_at: string | null
          active: boolean
          created_at: string
          doctor_id: string
          email: string | null
          id: string
          invited_at: string
          invited_by: string | null
          link_health: Database["public"]["Enums"]["portal_link_health"]
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          active?: boolean
          created_at?: string
          doctor_id: string
          email?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          link_health?: Database["public"]["Enums"]["portal_link_health"]
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          active?: boolean
          created_at?: string
          doctor_id?: string
          email?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          link_health?: Database["public"]["Enums"]["portal_link_health"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_portal_users_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_portal_users_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          active: boolean
          birth_date: string | null
          code: string
          cpf: string | null
          created_at: string
          created_by: string | null
          created_by_user_id: string | null
          crm: string
          crm_uf: string
          deactivated_at: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          pending_admin_review: boolean
          pending_review_note: string | null
          phone: string | null
          specialties: string[]
          state_uf: string | null
          updated_at: string
          vinculo: string | null
        }
        Insert: {
          active?: boolean
          birth_date?: string | null
          code?: string
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          created_by_user_id?: string | null
          crm: string
          crm_uf: string
          deactivated_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          phone?: string | null
          specialties?: string[]
          state_uf?: string | null
          updated_at?: string
          vinculo?: string | null
        }
        Update: {
          active?: boolean
          birth_date?: string | null
          code?: string
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          created_by_user_id?: string | null
          crm?: string
          crm_uf?: string
          deactivated_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          phone?: string | null
          specialties?: string[]
          state_uf?: string | null
          updated_at?: string
          vinculo?: string | null
        }
        Relationships: []
      }
      doctors_import_staging: {
        Row: {
          active: boolean
          birth_date: string | null
          cpf: string | null
          created_at: string
          crm: string
          crm_uf: string
          email: string | null
          full_name: string
          id: number
          imported_by: string | null
          notes_cnpj: string | null
          notes_pj: string | null
          phone: string | null
          specialties: string | null
          vinculo: string | null
        }
        Insert: {
          active?: boolean
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          crm: string
          crm_uf: string
          email?: string | null
          full_name: string
          id?: number
          imported_by?: string | null
          notes_cnpj?: string | null
          notes_pj?: string | null
          phone?: string | null
          specialties?: string | null
          vinculo?: string | null
        }
        Update: {
          active?: boolean
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          crm?: string
          crm_uf?: string
          email?: string | null
          full_name?: string
          id?: number
          imported_by?: string | null
          notes_cnpj?: string | null
          notes_pj?: string | null
          phone?: string | null
          specialties?: string | null
          vinculo?: string | null
        }
        Relationships: []
      }
      export_log: {
        Row: {
          created_at: string
          filters: Json
          format: string
          hospital_id: string
          id: string
          report_key: string
          report_label: string
          row_count: number | null
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          filters?: Json
          format: string
          hospital_id: string
          id?: string
          report_key: string
          report_label: string
          row_count?: number | null
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          filters?: Json
          format?: string
          hospital_id?: string
          id?: string
          report_key?: string
          report_label?: string
          row_count?: number | null
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          allowed_roles: string[]
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          rollout_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_roles?: string[]
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          rollout_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_roles?: string[]
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          rollout_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      financial_journal: {
        Row: {
          company_id: string | null
          competencia: string | null
          context: Json
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          doctor_id: string | null
          hospital_id: string
          id: string
          operation_id: string
          payment_id: string | null
          payment_item_id: string | null
          reason: string | null
          referencia: string | null
          reversed_by_entry_id: string | null
          reverses_entry_id: string | null
          sinal: number
          tipo: string
          valor: number
        }
        Insert: {
          company_id?: string | null
          competencia?: string | null
          context?: Json
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id: string
          id?: string
          operation_id: string
          payment_id?: string | null
          payment_item_id?: string | null
          reason?: string | null
          referencia?: string | null
          reversed_by_entry_id?: string | null
          reverses_entry_id?: string | null
          sinal: number
          tipo: string
          valor: number
        }
        Update: {
          company_id?: string | null
          competencia?: string | null
          context?: Json
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          operation_id?: string
          payment_id?: string | null
          payment_item_id?: string | null
          reason?: string | null
          referencia?: string | null
          reversed_by_entry_id?: string | null
          reverses_entry_id?: string | null
          sinal?: number
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_journal_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journal_reversed_by_entry_id_fkey"
            columns: ["reversed_by_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_journal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journal_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_journal"
            referencedColumns: ["id"]
          },
        ]
      }
      glosa_batches: {
        Row: {
          competence_month: string | null
          convenio: string | null
          created_at: string | null
          file_name: string | null
          hospital_id: string
          id: string
          matched_items: number | null
          reconciliation_id: string | null
          reference: string
          source: string
          status: string
          total_glosa_amount: number | null
          total_items: number | null
          unmatched_items: number | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          competence_month?: string | null
          convenio?: string | null
          created_at?: string | null
          file_name?: string | null
          hospital_id: string
          id?: string
          matched_items?: number | null
          reconciliation_id?: string | null
          reference: string
          source?: string
          status?: string
          total_glosa_amount?: number | null
          total_items?: number | null
          unmatched_items?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          competence_month?: string | null
          convenio?: string | null
          created_at?: string | null
          file_name?: string | null
          hospital_id?: string
          id?: string
          matched_items?: number | null
          reconciliation_id?: string | null
          reference?: string
          source?: string
          status?: string
          total_glosa_amount?: number | null
          total_items?: number | null
          unmatched_items?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "glosa_batches_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      glosa_debt_items: {
        Row: {
          amount: number
          applied_amount: number | null
          created_at: string | null
          debt_id: string
          glosa_item_id: string
          hospital_id: string
          id: string
        }
        Insert: {
          amount: number
          applied_amount?: number | null
          created_at?: string | null
          debt_id: string
          glosa_item_id: string
          hospital_id: string
          id?: string
        }
        Update: {
          amount?: number
          applied_amount?: number | null
          created_at?: string | null
          debt_id?: string
          glosa_item_id?: string
          hospital_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "glosa_debt_items_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "glosa_debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debt_items_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "v_glosa_debts_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debt_items_glosa_item_id_fkey"
            columns: ["glosa_item_id"]
            isOneToOne: false
            referencedRelation: "glosa_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debt_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      glosa_debts: {
        Row: {
          adjustment_id: string | null
          company_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          doctor_crm: string | null
          doctor_id: string
          doctor_name: string
          hospital_id: string
          id: string
          ignored_at: string | null
          ignored_by: string | null
          ignored_reason: string | null
          last_applied_at: string | null
          last_payment_id: string | null
          origem: string
          origem_payment_id: string | null
          origem_reconciliation_item_id: string | null
          parcelas_default: number
          resolution_reason: string | null
          resolution_status: string
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          status: string
          target_payment_id: string | null
          total_debt: number
          updated_at: string | null
        }
        Insert: {
          adjustment_id?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_id: string
          doctor_name: string
          hospital_id: string
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          ignored_reason?: string | null
          last_applied_at?: string | null
          last_payment_id?: string | null
          origem?: string
          origem_payment_id?: string | null
          origem_reconciliation_item_id?: string | null
          parcelas_default?: number
          resolution_reason?: string | null
          resolution_status?: string
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          status?: string
          target_payment_id?: string | null
          total_debt?: number
          updated_at?: string | null
        }
        Update: {
          adjustment_id?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_id?: string
          doctor_name?: string
          hospital_id?: string
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          ignored_reason?: string | null
          last_applied_at?: string | null
          last_payment_id?: string | null
          origem?: string
          origem_payment_id?: string | null
          origem_reconciliation_item_id?: string | null
          parcelas_default?: number
          resolution_reason?: string | null
          resolution_status?: string
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          status?: string
          target_payment_id?: string | null
          total_debt?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "glosa_debts_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_last_payment_id_fkey"
            columns: ["last_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_debts_last_payment_id_fkey"
            columns: ["last_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_last_payment_id_fkey"
            columns: ["last_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_debts_origem_payment_id_fkey"
            columns: ["origem_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_debts_origem_payment_id_fkey"
            columns: ["origem_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_origem_payment_id_fkey"
            columns: ["origem_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_debts_origem_reconciliation_item_id_fkey"
            columns: ["origem_reconciliation_item_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_target_payment_id_fkey"
            columns: ["target_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_debts_target_payment_id_fkey"
            columns: ["target_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_debts_target_payment_id_fkey"
            columns: ["target_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      glosa_item_match_history: {
        Row: {
          batch_id: string | null
          event_kind: string
          glosa_item_id: string
          id: string
          new_company_id: string | null
          new_company_name: string | null
          new_match_reason: string | null
          new_match_source: string | null
          new_status: string | null
          performed_at: string
          performed_by: string | null
          prev_company_id: string | null
          prev_company_name: string | null
          prev_match_reason: string | null
          prev_match_source: string | null
          prev_status: string | null
        }
        Insert: {
          batch_id?: string | null
          event_kind?: string
          glosa_item_id: string
          id?: string
          new_company_id?: string | null
          new_company_name?: string | null
          new_match_reason?: string | null
          new_match_source?: string | null
          new_status?: string | null
          performed_at?: string
          performed_by?: string | null
          prev_company_id?: string | null
          prev_company_name?: string | null
          prev_match_reason?: string | null
          prev_match_source?: string | null
          prev_status?: string | null
        }
        Update: {
          batch_id?: string | null
          event_kind?: string
          glosa_item_id?: string
          id?: string
          new_company_id?: string | null
          new_company_name?: string | null
          new_match_reason?: string | null
          new_match_source?: string | null
          new_status?: string | null
          performed_at?: string
          performed_by?: string | null
          prev_company_id?: string | null
          prev_company_name?: string | null
          prev_match_reason?: string | null
          prev_match_source?: string | null
          prev_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "glosa_item_match_history_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "glosa_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_item_match_history_glosa_item_id_fkey"
            columns: ["glosa_item_id"]
            isOneToOne: false
            referencedRelation: "glosa_items"
            referencedColumns: ["id"]
          },
        ]
      }
      glosa_items: {
        Row: {
          applied_at: string | null
          applied_payment_id: string | null
          attendance_number: string | null
          batch_id: string
          complemento_glosa: string | null
          convenio: string | null
          created_at: string | null
          doctor_crm: string | null
          doctor_name: string | null
          hospital_id: string
          id: string
          match_reason: string | null
          match_source: string | null
          matched_at: string | null
          matched_company_id: string | null
          matched_company_name: string | null
          matched_payment_id: string | null
          matched_payment_item_id: string | null
          motivo_glosa: string | null
          patient_name: string | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_name: string | null
          sector: string | null
          status: string
          valor_cobrado: number | null
          valor_glosa: number
        }
        Insert: {
          applied_at?: string | null
          applied_payment_id?: string | null
          attendance_number?: string | null
          batch_id: string
          complemento_glosa?: string | null
          convenio?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_name?: string | null
          hospital_id: string
          id?: string
          match_reason?: string | null
          match_source?: string | null
          matched_at?: string | null
          matched_company_id?: string | null
          matched_company_name?: string | null
          matched_payment_id?: string | null
          matched_payment_item_id?: string | null
          motivo_glosa?: string | null
          patient_name?: string | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          sector?: string | null
          status?: string
          valor_cobrado?: number | null
          valor_glosa?: number
        }
        Update: {
          applied_at?: string | null
          applied_payment_id?: string | null
          attendance_number?: string | null
          batch_id?: string
          complemento_glosa?: string | null
          convenio?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_name?: string | null
          hospital_id?: string
          id?: string
          match_reason?: string | null
          match_source?: string | null
          matched_at?: string | null
          matched_company_id?: string | null
          matched_company_name?: string | null
          matched_payment_id?: string | null
          matched_payment_item_id?: string | null
          motivo_glosa?: string | null
          patient_name?: string | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          sector?: string | null
          status?: string
          valor_cobrado?: number | null
          valor_glosa?: number
        }
        Relationships: [
          {
            foreignKeyName: "glosa_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "glosa_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_matched_company_id_fkey"
            columns: ["matched_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_items_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "glosa_items_matched_payment_item_id_fkey"
            columns: ["matched_payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "glosa_items_matched_payment_item_id_fkey"
            columns: ["matched_payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
        ]
      }
      glosa_payment_applications: {
        Row: {
          applied_at: string
          applied_by: string | null
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          doctor_id: string | null
          glosa_debt_id: string
          hospital_id: string
          id: string
          parcela_numero: number
          payment_id: string
          postpone_reason: string | null
          resolution_note: string | null
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          source: string
          status: string
          valor_aplicado: number
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          company_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          doctor_id?: string | null
          glosa_debt_id: string
          hospital_id: string
          id?: string
          parcela_numero: number
          payment_id: string
          postpone_reason?: string | null
          resolution_note?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          source?: string
          status?: string
          valor_aplicado: number
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          doctor_id?: string | null
          glosa_debt_id?: string
          hospital_id?: string
          id?: string
          parcela_numero?: number
          payment_id?: string
          postpone_reason?: string | null
          resolution_note?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          source?: string
          status?: string
          valor_aplicado?: number
        }
        Relationships: [
          {
            foreignKeyName: "glosa_payment_applications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_directors: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          email: string
          full_name: string
          hospital_id: string
          id: string
          notes: string | null
          role_label: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          email: string
          full_name: string
          hospital_id: string
          id?: string
          notes?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string
          hospital_id?: string
          id?: string
          notes?: string | null
          role_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_directors_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_settings: {
        Row: {
          created_at: string
          hospital_id: string
          min_payout_brl: number
          min_payout_pct: number
          reapproval_require_reason: boolean
          reapproval_threshold_brl: number
          reapproval_threshold_pct: number
          updated_at: string
          workflow_module: string
        }
        Insert: {
          created_at?: string
          hospital_id: string
          min_payout_brl?: number
          min_payout_pct?: number
          reapproval_require_reason?: boolean
          reapproval_threshold_brl?: number
          reapproval_threshold_pct?: number
          updated_at?: string
          workflow_module?: string
        }
        Update: {
          created_at?: string
          hospital_id?: string
          min_payout_brl?: number
          min_payout_pct?: number
          reapproval_require_reason?: boolean
          reapproval_threshold_brl?: number
          reapproval_threshold_pct?: number
          updated_at?: string
          workflow_module?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_settings_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: true
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_switch_log: {
        Row: {
          id: string
          new_hospital_id: string
          new_hospital_name: string | null
          old_hospital_id: string | null
          old_hospital_name: string | null
          switched_at: string
          user_agent: string | null
          user_email: string | null
          user_id: string
        }
        Insert: {
          id?: string
          new_hospital_id: string
          new_hospital_name?: string | null
          old_hospital_id?: string | null
          old_hospital_name?: string | null
          switched_at?: string
          user_agent?: string | null
          user_email?: string | null
          user_id: string
        }
        Update: {
          id?: string
          new_hospital_id?: string
          new_hospital_name?: string | null
          old_hospital_id?: string | null
          old_hospital_name?: string | null
          switched_at?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hospital_switch_log_new_hospital_id_fkey"
            columns: ["new_hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospital_switch_log_old_hospital_id_fkey"
            columns: ["old_hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          active: boolean
          cnpj: string | null
          code_prefix: string | null
          created_at: string
          id: string
          name: string
          slug: string
          state_uf: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj?: string | null
          code_prefix?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
          state_uf: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string | null
          code_prefix?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
          state_uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      internal_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          payload: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          payload?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          payload?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      intervention_ledger: {
        Row: {
          approved_at: string
          approved_by: string | null
          attendance_number: string | null
          autor_id: string | null
          cancellation_reason: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          delta: number
          doctor_name: string | null
          fonte: string
          hospital_id: string
          id: string
          item_id: string | null
          parcela_numero: number | null
          parcelas_total: number | null
          payment_id: string
          procedure_code: string | null
          procedure_name: string | null
          reverted_at: string | null
          reverted_reason: string | null
          valor_pago_final: number
          valor_regra: number
        }
        Insert: {
          approved_at: string
          approved_by?: string | null
          attendance_number?: string | null
          autor_id?: string | null
          cancellation_reason?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          delta?: number
          doctor_name?: string | null
          fonte: string
          hospital_id: string
          id?: string
          item_id?: string | null
          parcela_numero?: number | null
          parcelas_total?: number | null
          payment_id: string
          procedure_code?: string | null
          procedure_name?: string | null
          reverted_at?: string | null
          reverted_reason?: string | null
          valor_pago_final?: number
          valor_regra?: number
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          attendance_number?: string | null
          autor_id?: string | null
          cancellation_reason?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          delta?: number
          doctor_name?: string | null
          fonte?: string
          hospital_id?: string
          id?: string
          item_id?: string | null
          parcela_numero?: number | null
          parcelas_total?: number | null
          payment_id?: string
          procedure_code?: string | null
          procedure_name?: string | null
          reverted_at?: string | null
          reverted_reason?: string | null
          valor_pago_final?: number
          valor_regra?: number
        }
        Relationships: [
          {
            foreignKeyName: "intervention_ledger_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "intervention_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "intervention_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      invoice_question_attachments: {
        Row: {
          author_id: string | null
          author_type: string
          created_at: string
          file_name: string
          hospital_id: string
          id: string
          invoice_id: string
          mime_type: string
          payment_id: string
          question_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          author_id?: string | null
          author_type: string
          created_at?: string
          file_name: string
          hospital_id: string
          id?: string
          invoice_id: string
          mime_type: string
          payment_id: string
          question_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          created_at?: string
          file_name?: string
          hospital_id?: string
          id?: string
          invoice_id?: string
          mime_type?: string
          payment_id?: string
          question_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_question_attachments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_question_attachments_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "invoice_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_questions: {
        Row: {
          answered_at: string | null
          assigned_to: string | null
          author_id: string | null
          author_name: string | null
          author_type: string
          created_at: string
          first_response_at: string | null
          hospital_id: string
          id: string
          invoice_id: string
          message: string
          payment_id: string
          read_at: string | null
          sla_alerted_at: string | null
          status: string
        }
        Insert: {
          answered_at?: string | null
          assigned_to?: string | null
          author_id?: string | null
          author_name?: string | null
          author_type: string
          created_at?: string
          first_response_at?: string | null
          hospital_id: string
          id?: string
          invoice_id: string
          message: string
          payment_id: string
          read_at?: string | null
          sla_alerted_at?: string | null
          status?: string
        }
        Update: {
          answered_at?: string | null
          assigned_to?: string | null
          author_id?: string | null
          author_name?: string | null
          author_type?: string
          created_at?: string
          first_response_at?: string | null
          hospital_id?: string
          id?: string
          invoice_id?: string
          message?: string
          payment_id?: string
          read_at?: string | null
          sla_alerted_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_questions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_questions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "invoice_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      invoices: {
        Row: {
          ai_extracted_amount: number | null
          ai_extracted_cnpj: string | null
          ai_extracted_number: string | null
          ai_validated_at: string | null
          ai_validation: Json | null
          company_group_id: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          expected_amount: number
          file_path: string | null
          hospital_id: string
          id: string
          invoice_number: string | null
          items_count: number
          payment_id: string
          received_amount: number | null
          received_at: string | null
          recipient_cc: string[]
          recipient_email: string
          reconciliation_notes: string | null
          request_message: string | null
          send_error: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          upload_token: string
        }
        Insert: {
          ai_extracted_amount?: number | null
          ai_extracted_cnpj?: string | null
          ai_extracted_number?: string | null
          ai_validated_at?: string | null
          ai_validation?: Json | null
          company_group_id?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          expected_amount: number
          file_path?: string | null
          hospital_id: string
          id?: string
          invoice_number?: string | null
          items_count?: number
          payment_id: string
          received_amount?: number | null
          received_at?: string | null
          recipient_cc?: string[]
          recipient_email: string
          reconciliation_notes?: string | null
          request_message?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          upload_token?: string
        }
        Update: {
          ai_extracted_amount?: number | null
          ai_extracted_cnpj?: string | null
          ai_extracted_number?: string | null
          ai_validated_at?: string | null
          ai_validation?: Json | null
          company_group_id?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          expected_amount?: number
          file_path?: string | null
          hospital_id?: string
          id?: string
          invoice_number?: string | null
          items_count?: number
          payment_id?: string
          received_amount?: number | null
          received_at?: string | null
          recipient_cc?: string[]
          recipient_email?: string
          reconciliation_notes?: string | null
          request_message?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          upload_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "invoices_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      item_types: {
        Row: {
          active: boolean
          code: string
          color: string | null
          created_at: string
          default_function: string | null
          description: string | null
          id: string
          is_default_when_no_tuss: boolean
          label: string
          requires_tuss: boolean
          sort_order: number
          tuss_codes_extra: string[] | null
          tuss_default: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          color?: string | null
          created_at?: string
          default_function?: string | null
          description?: string | null
          id?: string
          is_default_when_no_tuss?: boolean
          label: string
          requires_tuss?: boolean
          sort_order?: number
          tuss_codes_extra?: string[] | null
          tuss_default?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          color?: string | null
          created_at?: string
          default_function?: string | null
          description?: string | null
          id?: string
          is_default_when_no_tuss?: boolean
          label?: string
          requires_tuss?: boolean
          sort_order?: number
          tuss_codes_extra?: string[] | null
          tuss_default?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      learned_pattern_events: {
        Row: {
          created_at: string
          hospital_id: string | null
          id: string
          pattern_id: string
          payload: Json
          payment_id: string | null
          payment_item_id: string | null
          source_id: string | null
          source_kind: string
        }
        Insert: {
          created_at?: string
          hospital_id?: string | null
          id?: string
          pattern_id: string
          payload?: Json
          payment_id?: string | null
          payment_item_id?: string | null
          source_id?: string | null
          source_kind: string
        }
        Update: {
          created_at?: string
          hospital_id?: string | null
          id?: string
          pattern_id?: string
          payload?: Json
          payment_id?: string | null
          payment_item_id?: string | null
          source_id?: string | null
          source_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_pattern_events_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_pattern_events_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "learned_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_patterns: {
        Row: {
          confidence: number
          created_at: string
          first_seen_at: string
          hospital_id: string
          id: string
          kind: string
          last_seen_at: string
          occurrences: number
          scope: Json
          scope_hash: string
          signal: Json
          silenced_at: string | null
          silenced_by: string | null
          silenced_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          first_seen_at?: string
          hospital_id: string
          id?: string
          kind: string
          last_seen_at?: string
          occurrences?: number
          scope: Json
          scope_hash: string
          signal?: Json
          silenced_at?: string | null
          silenced_by?: string | null
          silenced_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          first_seen_at?: string
          hospital_id?: string
          id?: string
          kind?: string
          last_seen_at?: string
          occurrences?: number
          scope?: Json
          scope_hash?: string
          signal?: Json
          silenced_at?: string | null
          silenced_by?: string | null
          silenced_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      magic_link_tokens: {
        Row: {
          action: Database["public"]["Enums"]["magic_link_action"]
          company_group_id: string | null
          created_at: string
          expires_at: string
          id: string
          issued_to_email: string
          issued_to_user_id: string
          payload: Json
          payment_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
          used_at: string | null
          used_by_ip: string | null
          used_by_user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["magic_link_action"]
          company_group_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issued_to_email: string
          issued_to_user_id: string
          payload?: Json
          payment_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash: string
          used_at?: string | null
          used_by_ip?: string | null
          used_by_user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["magic_link_action"]
          company_group_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_to_email?: string
          issued_to_user_id?: string
          payload?: Json
          payment_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash?: string
          used_at?: string | null
          used_by_ip?: string | null
          used_by_user_agent?: string | null
        }
        Relationships: []
      }
      manual_intervention_reasons: {
        Row: {
          applies_to: string[]
          category: string
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          financial_impact: string
          hospital_id: string | null
          id: string
          is_active: boolean
          is_seed: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          applies_to?: string[]
          category: string
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          financial_impact?: string
          hospital_id?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          applies_to?: string[]
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          financial_impact?: string
          hospital_id?: string | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_intervention_reasons_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      match_telemetry: {
        Row: {
          ai_confidence: number | null
          ai_decision: boolean | null
          ai_invoked: boolean | null
          ai_model: string | null
          ai_prompt: string | null
          ai_response: Json | null
          analyst_decision: string | null
          analyst_decision_at: string | null
          candidate_a: string | null
          candidate_b: string | null
          created_at: string
          entity_type: string
          fuzzy_score: number | null
          id: string
          payment_item_id: string | null
          pillars_matched: Json | null
          rule_id: string | null
          suggestion_id: string | null
          time_to_decision_seconds: number | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_decision?: boolean | null
          ai_invoked?: boolean | null
          ai_model?: string | null
          ai_prompt?: string | null
          ai_response?: Json | null
          analyst_decision?: string | null
          analyst_decision_at?: string | null
          candidate_a?: string | null
          candidate_b?: string | null
          created_at?: string
          entity_type: string
          fuzzy_score?: number | null
          id?: string
          payment_item_id?: string | null
          pillars_matched?: Json | null
          rule_id?: string | null
          suggestion_id?: string | null
          time_to_decision_seconds?: number | null
        }
        Update: {
          ai_confidence?: number | null
          ai_decision?: boolean | null
          ai_invoked?: boolean | null
          ai_model?: string | null
          ai_prompt?: string | null
          ai_response?: Json | null
          analyst_decision?: string | null
          analyst_decision_at?: string | null
          candidate_a?: string | null
          candidate_b?: string | null
          created_at?: string
          entity_type?: string
          fuzzy_score?: number | null
          id?: string
          payment_item_id?: string | null
          pillars_matched?: Json | null
          rule_id?: string | null
          suggestion_id?: string | null
          time_to_decision_seconds?: number | null
        }
        Relationships: []
      }
      minimum_guarantee_applications: {
        Row: {
          applied_at: string
          applied_by: string | null
          company_id: string
          competence_month: string
          complemento_valor: number
          created_at: string
          doctor_id: string | null
          hospital_id: string
          id: string
          notes: string | null
          payment_id: string | null
          piso_aplicado: number
          producao_calculada: number
          reverted_at: string | null
          reverted_by: string | null
          rule_id: string
          status: string
          synthetic_item_id: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          company_id: string
          competence_month: string
          complemento_valor?: number
          created_at?: string
          doctor_id?: string | null
          hospital_id: string
          id?: string
          notes?: string | null
          payment_id?: string | null
          piso_aplicado: number
          producao_calculada?: number
          reverted_at?: string | null
          reverted_by?: string | null
          rule_id: string
          status?: string
          synthetic_item_id?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          company_id?: string
          competence_month?: string
          complemento_valor?: number
          created_at?: string
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          notes?: string | null
          payment_id?: string | null
          piso_aplicado?: number
          producao_calculada?: number
          reverted_at?: string | null
          reverted_by?: string | null
          rule_id?: string
          status?: string
          synthetic_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "minimum_guarantee_applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules_pending_doctors_summary"
            referencedColumns: ["rule_id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_synthetic_item_id_fkey"
            columns: ["synthetic_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minimum_guarantee_applications_synthetic_item_id_fkey"
            columns: ["synthetic_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
        ]
      }
      notification_channels: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          event_key: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          event_key: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          event_key?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_deliveries: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivered_at: string | null
          error_message: string | null
          event_key: string
          failed_at: string | null
          id: string
          payment_id: string | null
          provider_message_id: string | null
          provider_response: Json | null
          queue_id: string | null
          read_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_delivery_status"]
          target_address: string
          template_key: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_key: string
          failed_at?: string | null
          id?: string
          payment_id?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          queue_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          target_address: string
          template_key?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_key?: string
          failed_at?: string | null
          id?: string
          payment_id?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          queue_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          target_address?: string
          template_key?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notification_queue: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"] | null
          created_at: string
          debounce_seconds: number
          events: Json
          first_event_at: string
          hospital_id: string
          id: string
          kind: string
          last_event_at: string
          payment_id: string | null
          sender_ids: string[]
          sent_at: string | null
          sent_meta: Json | null
          target_address: string | null
          template_key: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"] | null
          created_at?: string
          debounce_seconds?: number
          events?: Json
          first_event_at?: string
          hospital_id: string
          id?: string
          kind: string
          last_event_at?: string
          payment_id?: string | null
          sender_ids?: string[]
          sent_at?: string | null
          sent_meta?: Json | null
          target_address?: string | null
          template_key?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"] | null
          created_at?: string
          debounce_seconds?: number
          events?: Json
          first_event_at?: string
          hospital_id?: string
          id?: string
          kind?: string
          last_event_at?: string
          payment_id?: string | null
          sender_ids?: string[]
          sent_at?: string | null
          sent_meta?: Json | null
          target_address?: string | null
          template_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_queue_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "notification_queue_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_queue_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_assignments: {
        Row: {
          action: string
          analyst_id: string
          created_at: string
          created_by: string
          hospital_id: string
          id: string
          note: string | null
          payment_id: string
          previous_analyst_id: string | null
          source: string
        }
        Insert: {
          action: string
          analyst_id: string
          created_at?: string
          created_by: string
          hospital_id: string
          id?: string
          note?: string | null
          payment_id: string
          previous_analyst_id?: string | null
          source?: string
        }
        Update: {
          action?: string
          analyst_id?: string
          created_at?: string
          created_by?: string
          hospital_id?: string
          id?: string
          note?: string | null
          payment_id?: string
          previous_analyst_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_assignments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_assignments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_assignments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_assignments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_batch_patterns: {
        Row: {
          active: boolean
          alert_enabled: boolean
          aliases: string[]
          avg_bruto: number | null
          code: string
          created_at: string
          created_by: string | null
          expected_convenio_group: string | null
          expected_day_of_month: number | null
          expected_grace_days: number
          expected_setor: string | null
          hospital_id: string
          id: string
          label: string
          last_seen_month: string | null
          months_seen: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          alert_enabled?: boolean
          aliases?: string[]
          avg_bruto?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          expected_convenio_group?: string | null
          expected_day_of_month?: number | null
          expected_grace_days?: number
          expected_setor?: string | null
          hospital_id: string
          id?: string
          label: string
          last_seen_month?: string | null
          months_seen?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          alert_enabled?: boolean
          aliases?: string[]
          avg_bruto?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          expected_convenio_group?: string | null
          expected_day_of_month?: number | null
          expected_grace_days?: number
          expected_setor?: string | null
          hospital_id?: string
          id?: string
          label?: string
          last_seen_month?: string | null
          months_seen?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_batch_patterns_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_company_financials: {
        Row: {
          bruto: number
          company_id: string
          computed_at: string
          computed_by: string | null
          conciliacao: number
          conciliacao_aplicada: boolean
          created_at: string
          creditos: number
          debitos: number
          glosas: number
          hospital_id: string
          id: string
          liquido: number
          payment_id: string
          pool: number
          pool_aplicado: boolean
          pool_detalhes: Json
          pool_preview: boolean
          updated_at: string
        }
        Insert: {
          bruto?: number
          company_id: string
          computed_at?: string
          computed_by?: string | null
          conciliacao?: number
          conciliacao_aplicada?: boolean
          created_at?: string
          creditos?: number
          debitos?: number
          glosas?: number
          hospital_id: string
          id?: string
          liquido?: number
          payment_id: string
          pool?: number
          pool_aplicado?: boolean
          pool_detalhes?: Json
          pool_preview?: boolean
          updated_at?: string
        }
        Update: {
          bruto?: number
          company_id?: string
          computed_at?: string
          computed_by?: string | null
          conciliacao?: number
          conciliacao_aplicada?: boolean
          created_at?: string
          creditos?: number
          debitos?: number
          glosas?: number
          hospital_id?: string
          id?: string
          liquido?: number
          payment_id?: string
          pool?: number
          pool_aplicado?: boolean
          pool_detalhes?: Json
          pool_preview?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_company_financials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_financials_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_financials_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_company_financials_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_financials_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_company_groups: {
        Row: {
          approval_evidence_path: string | null
          approval_external_note: string | null
          approval_on_behalf_of: string | null
          approval_registered_by: string | null
          approval_source: string
          approval_version: number
          approved_at: string | null
          approved_by: string | null
          bruto_total: number
          cancellation_note: string | null
          cancellation_previous_status:
            | Database["public"]["Enums"]["payment_status"]
            | null
          cancellation_reactivated_at: string | null
          cancellation_reactivated_by: string | null
          cancellation_reason:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string | null
          company_name: string
          confeccao_finalized_at: string | null
          confeccao_finalized_by: string | null
          confeccao_status:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          created_at: string
          hospital_id: string
          id: string
          is_test: boolean
          items_count: number
          last_approved_bruto: number | null
          last_approved_company_id: string | null
          last_approved_liquido: number | null
          liquido_total: number
          payment_id: string
          reapproval_pending: boolean
          reapproval_reason: string | null
          reapproval_trigger_source:
            | Database["public"]["Enums"]["reapproval_trigger_source"]
            | null
          reapproval_triggered_at: string | null
          reconciliation_run_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          validation_evidence_path: string | null
          validation_external_note: string | null
          validation_on_behalf_of: string | null
          validation_registered_by: string | null
          validation_source: string
        }
        Insert: {
          approval_evidence_path?: string | null
          approval_external_note?: string | null
          approval_on_behalf_of?: string | null
          approval_registered_by?: string | null
          approval_source?: string
          approval_version?: number
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          cancellation_note?: string | null
          cancellation_previous_status?:
            | Database["public"]["Enums"]["payment_status"]
            | null
          cancellation_reactivated_at?: string | null
          cancellation_reactivated_by?: string | null
          cancellation_reason?:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name: string
          confeccao_finalized_at?: string | null
          confeccao_finalized_by?: string | null
          confeccao_status?:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          created_at?: string
          hospital_id: string
          id?: string
          is_test?: boolean
          items_count?: number
          last_approved_bruto?: number | null
          last_approved_company_id?: string | null
          last_approved_liquido?: number | null
          liquido_total?: number
          payment_id: string
          reapproval_pending?: boolean
          reapproval_reason?: string | null
          reapproval_trigger_source?:
            | Database["public"]["Enums"]["reapproval_trigger_source"]
            | null
          reapproval_triggered_at?: string | null
          reconciliation_run_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_evidence_path?: string | null
          validation_external_note?: string | null
          validation_on_behalf_of?: string | null
          validation_registered_by?: string | null
          validation_source?: string
        }
        Update: {
          approval_evidence_path?: string | null
          approval_external_note?: string | null
          approval_on_behalf_of?: string | null
          approval_registered_by?: string | null
          approval_source?: string
          approval_version?: number
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          cancellation_note?: string | null
          cancellation_previous_status?:
            | Database["public"]["Enums"]["payment_status"]
            | null
          cancellation_reactivated_at?: string | null
          cancellation_reactivated_by?: string | null
          cancellation_reason?:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name?: string
          confeccao_finalized_at?: string | null
          confeccao_finalized_by?: string | null
          confeccao_status?:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          created_at?: string
          hospital_id?: string
          id?: string
          is_test?: boolean
          items_count?: number
          last_approved_bruto?: number | null
          last_approved_company_id?: string | null
          last_approved_liquido?: number | null
          liquido_total?: number
          payment_id?: string
          reapproval_pending?: boolean
          reapproval_reason?: string | null
          reapproval_trigger_source?:
            | Database["public"]["Enums"]["reapproval_trigger_source"]
            | null
          reapproval_triggered_at?: string | null
          reconciliation_run_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_evidence_path?: string | null
          validation_external_note?: string | null
          validation_on_behalf_of?: string | null
          validation_registered_by?: string | null
          validation_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_company_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_company_groups_reconciliation_run_id_fkey"
            columns: ["reconciliation_run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_director_notifications: {
        Row: {
          email_results: Json
          hospital_id: string
          id: string
          notified_at: string
          payment_id: string
          whatsapp_results: Json
        }
        Insert: {
          email_results?: Json
          hospital_id: string
          id?: string
          notified_at?: string
          payment_id: string
          whatsapp_results?: Json
        }
        Update: {
          email_results?: Json
          hospital_id?: string
          id?: string
          notified_at?: string
          payment_id?: string
          whatsapp_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_director_notifications_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_director_notifications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_director_notifications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_director_notifications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_email_approvals: {
        Row: {
          ai_model: string | null
          applied_at: string | null
          applied_by: string | null
          created_at: string
          extracted: Json | null
          file_mime: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          hospital_id: string
          id: string
          matched_director_id: string | null
          parse_attempts: number
          parsed_at: string | null
          payment_id: string
          reject_reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          status: Database["public"]["Enums"]["email_approval_status"]
          updated_at: string
          uploaded_at: string
          uploaded_by: string
          validation_errors: string[]
        }
        Insert: {
          ai_model?: string | null
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          extracted?: Json | null
          file_mime: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          hospital_id: string
          id?: string
          matched_director_id?: string | null
          parse_attempts?: number
          parsed_at?: string | null
          payment_id: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: Database["public"]["Enums"]["email_approval_status"]
          updated_at?: string
          uploaded_at?: string
          uploaded_by: string
          validation_errors?: string[]
        }
        Update: {
          ai_model?: string | null
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          extracted?: Json | null
          file_mime?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          hospital_id?: string
          id?: string
          matched_director_id?: string | null
          parse_attempts?: number
          parsed_at?: string | null
          payment_id?: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: Database["public"]["Enums"]["email_approval_status"]
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
          validation_errors?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "payment_email_approvals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_email_approvals_matched_director_id_fkey"
            columns: ["matched_director_id"]
            isOneToOne: false
            referencedRelation: "hospital_directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_email_approvals_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_email_approvals_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_email_approvals_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_engine_sources: {
        Row: {
          applicable: boolean
          applied_count: number
          details: Json
          job_id: string | null
          payment_id: string
          read_at: string | null
          source: string
          total_value: number
          updated_at: string
        }
        Insert: {
          applicable?: boolean
          applied_count?: number
          details?: Json
          job_id?: string | null
          payment_id: string
          read_at?: string | null
          source: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          applicable?: boolean
          applied_count?: number
          details?: Json
          job_id?: string | null
          payment_id?: string
          read_at?: string | null
          source?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_engine_sources_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_engine_sources_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_engine_sources_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_group_reconciliation_overrides: {
        Row: {
          approved_by: string
          bruto_pedido_snapshot: number
          bruto_regra_snapshot: number
          created_at: string
          diferenca_snapshot: number
          group_id: string
          hospital_id: string
          id: string
          justification: string
        }
        Insert: {
          approved_by: string
          bruto_pedido_snapshot: number
          bruto_regra_snapshot: number
          created_at?: string
          diferenca_snapshot: number
          group_id: string
          hospital_id: string
          id?: string
          justification: string
        }
        Update: {
          approved_by?: string
          bruto_pedido_snapshot?: number
          bruto_regra_snapshot?: number
          created_at?: string
          diferenca_snapshot?: number
          group_id?: string
          hospital_id?: string
          id?: string
          justification?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_group_reconciliation_overrides_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_group_reconciliation_overrides_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
        ]
      }
      payment_item_hints: {
        Row: {
          confidence: number
          created_at: string
          hospital_id: string
          id: string
          kind: string
          message: string | null
          pattern_id: string
          payment_item_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          hospital_id: string
          id?: string
          kind: string
          message?: string | null
          pattern_id: string
          payment_item_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          hospital_id?: string
          id?: string
          kind?: string
          message?: string | null
          pattern_id?: string
          payment_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_item_hints_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "learned_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_item_hints_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_item_hints_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
        ]
      }
      payment_items: {
        Row: {
          absorbed_by_pool_id: string | null
          absorbed_by_run_id: string | null
          acatado_at: string | null
          acatado_by: string | null
          acatado_status_original: string | null
          access_route: string | null
          agreement_text: string | null
          ai_cached_at: string | null
          ai_findings: Json | null
          ai_input_hash: string | null
          ai_status: Database["public"]["Enums"]["item_ai_status"]
          applied_at: string | null
          applied_calc_id: string | null
          applied_calc_method: string | null
          applied_rule_id: string | null
          applied_rule_label: string | null
          attendance_character: string | null
          attendance_group_key: string | null
          attendance_number: string | null
          authorized_exception: boolean
          basis_confidence: number | null
          bonus_base_amount: number | null
          bonus_fixed_amount: number | null
          bonus_pct_amount: number | null
          calc_exception_marked_at: string | null
          calc_exception_marked_by: string | null
          calc_exception_reason: string | null
          calc_exception_skip: boolean
          calc_exception_skipped_calc_id: string | null
          cancellation_note: string | null
          cancellation_reactivated_at: string | null
          cancellation_reactivated_by: string | null
          cancellation_reason:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string | null
          company_name: string | null
          competence_source: string | null
          complement_reason: string | null
          convenio_basis_detected: string | null
          convenio_matched_by: string | null
          convenio_slug: string | null
          convenio_value_totalized: boolean
          cost_center_code: string | null
          created_at: string
          created_by_user_id: string | null
          description: string | null
          doctor_document: string | null
          doctor_email: string | null
          doctor_id: string | null
          doctor_matched_by: string | null
          doctor_name: string
          doctor_role: string | null
          empresa_liquido_total: number | null
          empresa_tem_pool: boolean
          exception_attachment_path: string | null
          exception_authorizer: string | null
          exception_marked_at: string | null
          exception_marked_by: string | null
          exception_note: string | null
          exception_reason: string | null
          expected_amount: number | null
          expected_amount_original: number | null
          gross_amount: number | null
          gross_amount_original: number | null
          gross_override_at: string | null
          gross_override_by: string | null
          gross_override_reason: string | null
          hospital_id: string
          id: string
          intervention_financial_impact: string | null
          intervention_notes: string | null
          intervention_reason_id: string | null
          is_cancelled: boolean
          is_manual_entry: boolean
          is_pool_item: boolean
          item_competence: string | null
          item_hash: string | null
          item_origem: string | null
          item_origin: string
          item_type_id: string | null
          item_type_source: string | null
          manual_composition: Json | null
          manual_edit: boolean
          manual_entered_at: string | null
          manual_entered_by: string | null
          manual_entry: boolean
          manual_intervention_at: string | null
          manual_intervention_by: string | null
          manual_intervention_notes: string | null
          manual_intervention_reason_id: string | null
          manual_intervention_source: string | null
          manual_note: string | null
          manual_source_attachment_path: string | null
          origem_reconciliation_item_id: string | null
          origem_referencia: string | null
          package_absorbed: boolean | null
          package_absorbed_at: string | null
          package_absorbed_by: string | null
          package_absorbed_calc_id: string | null
          package_absorbed_note: string | null
          package_ambiguity: Json | null
          parecer_alert: string | null
          parecer_checked_at: string | null
          parecer_espec_origem: string | null
          parecer_evidence: string | null
          parecer_evidence_weak: boolean
          parecer_medico_solicitante: string | null
          parecer_nr: string | null
          parecer_report_row_id: string | null
          patient_name: string | null
          payment_id: string
          piso_aplicado_valor: number | null
          piso_context: Json | null
          piso_metodo_vencedor: string | null
          procedure_amount: number | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_date_has_time: boolean
          procedure_name: string | null
          quantity: number | null
          rateio: Json | null
          raw_data: Json | null
          reclassified_from_parecer: boolean
          reconciliation_run_id: string | null
          sector: string | null
          sector_matched_by: string | null
          sector_original: string | null
          sector_slug: string | null
          source: string
          source_file_name: string | null
          special_case_code: string | null
          special_case_status:
            | Database["public"]["Enums"]["special_case_status"]
            | null
          specialty: string | null
          synthetic_bonus: boolean
          tipo_item: string | null
          tipo_linha: string | null
          validation_findings: Json
        }
        Insert: {
          absorbed_by_pool_id?: string | null
          absorbed_by_run_id?: string | null
          acatado_at?: string | null
          acatado_by?: string | null
          acatado_status_original?: string | null
          access_route?: string | null
          agreement_text?: string | null
          ai_cached_at?: string | null
          ai_findings?: Json | null
          ai_input_hash?: string | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          applied_at?: string | null
          applied_calc_id?: string | null
          applied_calc_method?: string | null
          applied_rule_id?: string | null
          applied_rule_label?: string | null
          attendance_character?: string | null
          attendance_group_key?: string | null
          attendance_number?: string | null
          authorized_exception?: boolean
          basis_confidence?: number | null
          bonus_base_amount?: number | null
          bonus_fixed_amount?: number | null
          bonus_pct_amount?: number | null
          calc_exception_marked_at?: string | null
          calc_exception_marked_by?: string | null
          calc_exception_reason?: string | null
          calc_exception_skip?: boolean
          calc_exception_skipped_calc_id?: string | null
          cancellation_note?: string | null
          cancellation_reactivated_at?: string | null
          cancellation_reactivated_by?: string | null
          cancellation_reason?:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name?: string | null
          competence_source?: string | null
          complement_reason?: string | null
          convenio_basis_detected?: string | null
          convenio_matched_by?: string | null
          convenio_slug?: string | null
          convenio_value_totalized?: boolean
          cost_center_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_id?: string | null
          doctor_matched_by?: string | null
          doctor_name: string
          doctor_role?: string | null
          empresa_liquido_total?: number | null
          empresa_tem_pool?: boolean
          exception_attachment_path?: string | null
          exception_authorizer?: string | null
          exception_marked_at?: string | null
          exception_marked_by?: string | null
          exception_note?: string | null
          exception_reason?: string | null
          expected_amount?: number | null
          expected_amount_original?: number | null
          gross_amount?: number | null
          gross_amount_original?: number | null
          gross_override_at?: string | null
          gross_override_by?: string | null
          gross_override_reason?: string | null
          hospital_id: string
          id?: string
          intervention_financial_impact?: string | null
          intervention_notes?: string | null
          intervention_reason_id?: string | null
          is_cancelled?: boolean
          is_manual_entry?: boolean
          is_pool_item?: boolean
          item_competence?: string | null
          item_hash?: string | null
          item_origem?: string | null
          item_origin?: string
          item_type_id?: string | null
          item_type_source?: string | null
          manual_composition?: Json | null
          manual_edit?: boolean
          manual_entered_at?: string | null
          manual_entered_by?: string | null
          manual_entry?: boolean
          manual_intervention_at?: string | null
          manual_intervention_by?: string | null
          manual_intervention_notes?: string | null
          manual_intervention_reason_id?: string | null
          manual_intervention_source?: string | null
          manual_note?: string | null
          manual_source_attachment_path?: string | null
          origem_reconciliation_item_id?: string | null
          origem_referencia?: string | null
          package_absorbed?: boolean | null
          package_absorbed_at?: string | null
          package_absorbed_by?: string | null
          package_absorbed_calc_id?: string | null
          package_absorbed_note?: string | null
          package_ambiguity?: Json | null
          parecer_alert?: string | null
          parecer_checked_at?: string | null
          parecer_espec_origem?: string | null
          parecer_evidence?: string | null
          parecer_evidence_weak?: boolean
          parecer_medico_solicitante?: string | null
          parecer_nr?: string | null
          parecer_report_row_id?: string | null
          patient_name?: string | null
          payment_id: string
          piso_aplicado_valor?: number | null
          piso_context?: Json | null
          piso_metodo_vencedor?: string | null
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_date_has_time?: boolean
          procedure_name?: string | null
          quantity?: number | null
          rateio?: Json | null
          raw_data?: Json | null
          reclassified_from_parecer?: boolean
          reconciliation_run_id?: string | null
          sector?: string | null
          sector_matched_by?: string | null
          sector_original?: string | null
          sector_slug?: string | null
          source?: string
          source_file_name?: string | null
          special_case_code?: string | null
          special_case_status?:
            | Database["public"]["Enums"]["special_case_status"]
            | null
          specialty?: string | null
          synthetic_bonus?: boolean
          tipo_item?: string | null
          tipo_linha?: string | null
          validation_findings?: Json
        }
        Update: {
          absorbed_by_pool_id?: string | null
          absorbed_by_run_id?: string | null
          acatado_at?: string | null
          acatado_by?: string | null
          acatado_status_original?: string | null
          access_route?: string | null
          agreement_text?: string | null
          ai_cached_at?: string | null
          ai_findings?: Json | null
          ai_input_hash?: string | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          applied_at?: string | null
          applied_calc_id?: string | null
          applied_calc_method?: string | null
          applied_rule_id?: string | null
          applied_rule_label?: string | null
          attendance_character?: string | null
          attendance_group_key?: string | null
          attendance_number?: string | null
          authorized_exception?: boolean
          basis_confidence?: number | null
          bonus_base_amount?: number | null
          bonus_fixed_amount?: number | null
          bonus_pct_amount?: number | null
          calc_exception_marked_at?: string | null
          calc_exception_marked_by?: string | null
          calc_exception_reason?: string | null
          calc_exception_skip?: boolean
          calc_exception_skipped_calc_id?: string | null
          cancellation_note?: string | null
          cancellation_reactivated_at?: string | null
          cancellation_reactivated_by?: string | null
          cancellation_reason?:
            | Database["public"]["Enums"]["payment_cancellation_reason"]
            | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name?: string | null
          competence_source?: string | null
          complement_reason?: string | null
          convenio_basis_detected?: string | null
          convenio_matched_by?: string | null
          convenio_slug?: string | null
          convenio_value_totalized?: boolean
          cost_center_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_id?: string | null
          doctor_matched_by?: string | null
          doctor_name?: string
          doctor_role?: string | null
          empresa_liquido_total?: number | null
          empresa_tem_pool?: boolean
          exception_attachment_path?: string | null
          exception_authorizer?: string | null
          exception_marked_at?: string | null
          exception_marked_by?: string | null
          exception_note?: string | null
          exception_reason?: string | null
          expected_amount?: number | null
          expected_amount_original?: number | null
          gross_amount?: number | null
          gross_amount_original?: number | null
          gross_override_at?: string | null
          gross_override_by?: string | null
          gross_override_reason?: string | null
          hospital_id?: string
          id?: string
          intervention_financial_impact?: string | null
          intervention_notes?: string | null
          intervention_reason_id?: string | null
          is_cancelled?: boolean
          is_manual_entry?: boolean
          is_pool_item?: boolean
          item_competence?: string | null
          item_hash?: string | null
          item_origem?: string | null
          item_origin?: string
          item_type_id?: string | null
          item_type_source?: string | null
          manual_composition?: Json | null
          manual_edit?: boolean
          manual_entered_at?: string | null
          manual_entered_by?: string | null
          manual_entry?: boolean
          manual_intervention_at?: string | null
          manual_intervention_by?: string | null
          manual_intervention_notes?: string | null
          manual_intervention_reason_id?: string | null
          manual_intervention_source?: string | null
          manual_note?: string | null
          manual_source_attachment_path?: string | null
          origem_reconciliation_item_id?: string | null
          origem_referencia?: string | null
          package_absorbed?: boolean | null
          package_absorbed_at?: string | null
          package_absorbed_by?: string | null
          package_absorbed_calc_id?: string | null
          package_absorbed_note?: string | null
          package_ambiguity?: Json | null
          parecer_alert?: string | null
          parecer_checked_at?: string | null
          parecer_espec_origem?: string | null
          parecer_evidence?: string | null
          parecer_evidence_weak?: boolean
          parecer_medico_solicitante?: string | null
          parecer_nr?: string | null
          parecer_report_row_id?: string | null
          patient_name?: string | null
          payment_id?: string
          piso_aplicado_valor?: number | null
          piso_context?: Json | null
          piso_metodo_vencedor?: string | null
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_date_has_time?: boolean
          procedure_name?: string | null
          quantity?: number | null
          rateio?: Json | null
          raw_data?: Json | null
          reclassified_from_parecer?: boolean
          reconciliation_run_id?: string | null
          sector?: string | null
          sector_matched_by?: string | null
          sector_original?: string | null
          sector_slug?: string | null
          source?: string
          source_file_name?: string | null
          special_case_code?: string | null
          special_case_status?:
            | Database["public"]["Enums"]["special_case_status"]
            | null
          specialty?: string | null
          synthetic_bonus?: boolean
          tipo_item?: string | null
          tipo_linha?: string | null
          validation_findings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_absorbed_by_pool_id_fkey"
            columns: ["absorbed_by_pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_absorbed_by_run_id_fkey"
            columns: ["absorbed_by_run_id"]
            isOneToOne: false
            referencedRelation: "pool_calculation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_applied_calc_id_fkey"
            columns: ["applied_calc_id"]
            isOneToOne: false
            referencedRelation: "rule_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_applied_rule_id_fkey"
            columns: ["applied_rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_applied_rule_id_fkey"
            columns: ["applied_rule_id"]
            isOneToOne: false
            referencedRelation: "rules_pending_doctors_summary"
            referencedColumns: ["rule_id"]
          },
          {
            foreignKeyName: "payment_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_convenio_slug_fkey"
            columns: ["convenio_slug"]
            isOneToOne: false
            referencedRelation: "convenios"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "payment_items_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_intervention_reason_id_fkey"
            columns: ["intervention_reason_id"]
            isOneToOne: false
            referencedRelation: "manual_intervention_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_manual_intervention_reason_id_fkey"
            columns: ["manual_intervention_reason_id"]
            isOneToOne: false
            referencedRelation: "manual_intervention_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_origem_reconciliation_item_id_fkey"
            columns: ["origem_reconciliation_item_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_package_absorbed_calc_id_fkey"
            columns: ["package_absorbed_calc_id"]
            isOneToOne: false
            referencedRelation: "rule_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_parecer_report_row_id_fkey"
            columns: ["parecer_report_row_id"]
            isOneToOne: false
            referencedRelation: "payment_parecer_report_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_items_reconciliation_run_id_fkey"
            columns: ["reconciliation_run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_sector_slug_fkey"
            columns: ["sector_slug"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["slug"]
          },
        ]
      }
      payment_job_context: {
        Row: {
          built_at: string
          context: Json
          hospital_id: string
          is_snapshot: boolean
          job_id: string
          meta: Json
          payment_id: string
          size_bytes: number | null
        }
        Insert: {
          built_at?: string
          context: Json
          hospital_id: string
          is_snapshot?: boolean
          job_id: string
          meta?: Json
          payment_id: string
          size_bytes?: number | null
        }
        Update: {
          built_at?: string
          context?: Json
          hospital_id?: string
          is_snapshot?: boolean
          job_id?: string
          meta?: Json
          payment_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_job_context_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_models: {
        Row: {
          active: boolean
          allow_mixed_item_types: boolean
          calc_strategy: string | null
          code: string
          color: string | null
          created_at: string
          description: string | null
          expected_headers: Json | null
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allow_mixed_item_types?: boolean
          calc_strategy?: string | null
          code: string
          color?: string | null
          created_at?: string
          description?: string | null
          expected_headers?: Json | null
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allow_mixed_item_types?: boolean
          calc_strategy?: string | null
          code?: string
          color?: string | null
          created_at?: string
          description?: string | null
          expected_headers?: Json | null
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_observations: {
        Row: {
          answered_by_observation_id: string | null
          author_id: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at: string
          edited_at: string | null
          hospital_id: string
          id: string
          is_question: boolean
          item_id: string | null
          message: string
          observation_type: Database["public"]["Enums"]["observation_type"]
          payment_id: string
          resolved_at: string | null
          resolved_by: string | null
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"] | null
        }
        Insert: {
          answered_by_observation_id?: string | null
          author_id?: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at?: string
          edited_at?: string | null
          hospital_id: string
          id?: string
          is_question?: boolean
          item_id?: string | null
          message: string
          observation_type?: Database["public"]["Enums"]["observation_type"]
          payment_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
        }
        Update: {
          answered_by_observation_id?: string | null
          author_id?: string | null
          author_type?: Database["public"]["Enums"]["observation_author"]
          created_at?: string
          edited_at?: string | null
          hospital_id?: string
          id?: string
          is_question?: boolean
          item_id?: string | null
          message?: string
          observation_type?: Database["public"]["Enums"]["observation_type"]
          payment_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_observations_answered_by_observation_id_fkey"
            columns: ["answered_by_observation_id"]
            isOneToOne: false
            referencedRelation: "payment_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_observations_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_observations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_observations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "payment_observations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_observations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_observations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_parecer_report_rows: {
        Row: {
          atendimento: string | null
          created_at: string
          dt_resposta_parecer: string | null
          dt_solic_parecer: string | null
          espec_destino: string | null
          espec_origem: string | null
          hora_confiavel: boolean
          id: string
          medico_resposta: string | null
          medico_resposta_crm: string | null
          medico_solicitante: string | null
          nr_parecer: string | null
          paciente: string | null
          raw: Json | null
          report_id: string
          situacao: string | null
          tempo_resposta: string | null
        }
        Insert: {
          atendimento?: string | null
          created_at?: string
          dt_resposta_parecer?: string | null
          dt_solic_parecer?: string | null
          espec_destino?: string | null
          espec_origem?: string | null
          hora_confiavel?: boolean
          id?: string
          medico_resposta?: string | null
          medico_resposta_crm?: string | null
          medico_solicitante?: string | null
          nr_parecer?: string | null
          paciente?: string | null
          raw?: Json | null
          report_id: string
          situacao?: string | null
          tempo_resposta?: string | null
        }
        Update: {
          atendimento?: string | null
          created_at?: string
          dt_resposta_parecer?: string | null
          dt_solic_parecer?: string | null
          espec_destino?: string | null
          espec_origem?: string | null
          hora_confiavel?: boolean
          id?: string
          medico_resposta?: string | null
          medico_resposta_crm?: string | null
          medico_solicitante?: string | null
          nr_parecer?: string | null
          paciente?: string | null
          raw?: Json | null
          report_id?: string
          situacao?: string | null
          tempo_resposta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_parecer_report_rows_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "payment_parecer_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_parecer_reports: {
        Row: {
          created_at: string
          cross_summary: Json | null
          hospital_id: string
          id: string
          imported_at: string
          imported_by: string | null
          notes: string | null
          payment_id: string
          period_end: string
          period_start: string
          row_count: number
          source_file_hash: string | null
          source_filename: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cross_summary?: Json | null
          hospital_id: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes?: string | null
          payment_id: string
          period_end: string
          period_start: string
          row_count?: number
          source_file_hash?: string | null
          source_filename?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cross_summary?: Json | null
          hospital_id?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes?: string | null
          payment_id?: string
          period_end?: string
          period_start?: string
          row_count?: number
          source_file_hash?: string | null
          source_filename?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_parecer_reports_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_parecer_reports_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_parecer_reports_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_parecer_reports_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_pivot_cache: {
        Row: {
          cache_key: string
          created_at: string
          hospital_id: string
          id: string
          payment_id: string
          rows: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          hospital_id: string
          id?: string
          payment_id: string
          rows: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          hospital_id?: string
          id?: string
          payment_id?: string
          rows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_pivot_cache_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_pivot_cache_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_pivot_cache_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_pivot_cache_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_processing_jobs: {
        Row: {
          company_list: string[] | null
          created_at: string
          current_page: number
          failed_companies: Json
          finished_at: string | null
          hospital_id: string
          id: string
          payment_id: string
          processed_companies: number
          started_at: string
          status: string
          total_companies: number
          total_items: number | null
          updated_at: string
        }
        Insert: {
          company_list?: string[] | null
          created_at?: string
          current_page?: number
          failed_companies?: Json
          finished_at?: string | null
          hospital_id: string
          id?: string
          payment_id: string
          processed_companies?: number
          started_at?: string
          status?: string
          total_companies?: number
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          company_list?: string[] | null
          created_at?: string
          current_page?: number
          failed_companies?: Json
          finished_at?: string | null
          hospital_id?: string
          id?: string
          payment_id?: string
          processed_companies?: number
          started_at?: string
          status?: string
          total_companies?: number
          total_items?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_processing_jobs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_processing_jobs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_processing_jobs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_processing_jobs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_question_reads: {
        Row: {
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_question_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "payment_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_questions: {
        Row: {
          answered_at: string | null
          assigned_to: string | null
          author_id: string
          author_name: string
          author_type: string
          company_group_id: string | null
          created_at: string
          first_response_at: string | null
          hospital_id: string
          id: string
          message: string
          parent_id: string | null
          payment_id: string
          read_at: string | null
          sla_alerted_at: string | null
          status: string
        }
        Insert: {
          answered_at?: string | null
          assigned_to?: string | null
          author_id: string
          author_name: string
          author_type?: string
          company_group_id?: string | null
          created_at?: string
          first_response_at?: string | null
          hospital_id: string
          id?: string
          message: string
          parent_id?: string | null
          payment_id: string
          read_at?: string | null
          sla_alerted_at?: string | null
          status?: string
        }
        Update: {
          answered_at?: string | null
          assigned_to?: string | null
          author_id?: string
          author_name?: string
          author_type?: string
          company_group_id?: string | null
          created_at?: string
          first_response_at?: string | null
          hospital_id?: string
          id?: string
          message?: string
          parent_id?: string | null
          payment_id?: string
          read_at?: string | null
          sla_alerted_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_questions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "payment_questions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "payment_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_questions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_recompute_failures: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          error_message: string
          first_failed_at: string
          hospital_id: string | null
          id: string
          last_attempt_at: string
          payment_id: string
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message: string
          first_failed_at?: string
          hospital_id?: string | null
          id?: string
          last_attempt_at?: string
          payment_id: string
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string
          first_failed_at?: string
          hospital_id?: string | null
          id?: string
          last_attempt_at?: string
          payment_id?: string
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_recompute_failures_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_recompute_failures_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_recompute_failures_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_recompute_failures_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_source_files: {
        Row: {
          bucket_role: string
          created_at: string
          id: string
          is_legacy: boolean
          mime_type: string | null
          original_filename: string
          payment_id: string
          sha256: string | null
          sheet_name: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          bucket_role?: string
          created_at?: string
          id?: string
          is_legacy?: boolean
          mime_type?: string | null
          original_filename: string
          payment_id: string
          sha256?: string | null
          sheet_name?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          bucket_role?: string
          created_at?: string
          id?: string
          is_legacy?: boolean
          mime_type?: string | null
          original_filename?: string
          payment_id?: string
          sha256?: string | null
          sheet_name?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_source_files_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_source_files_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_source_files_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          hospital_id: string
          id: string
          payment_id: string
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          hospital_id: string
          id?: string
          payment_id: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          hospital_id?: string
          id?: string
          payment_id?: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_status_history_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_status_history_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_status_history_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_status_history_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payment_types: {
        Row: {
          active: boolean
          allow_mixed_subtypes: boolean
          calc_strategy: string
          category: string | null
          code: string
          color: string | null
          created_at: string
          created_by: string | null
          default_function: string | null
          default_value_column_hint: string | null
          description: string | null
          expected_headers: Json
          id: string
          label: string
          requires_tuss_in_sheet: boolean
          sort_order: number
          subtype_split_hint: Json | null
          tuss_codes_extra: string[]
          tuss_default: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          allow_mixed_subtypes?: boolean
          calc_strategy?: string
          category?: string | null
          code: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_function?: string | null
          default_value_column_hint?: string | null
          description?: string | null
          expected_headers?: Json
          id?: string
          label: string
          requires_tuss_in_sheet?: boolean
          sort_order?: number
          subtype_split_hint?: Json | null
          tuss_codes_extra?: string[]
          tuss_default?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          allow_mixed_subtypes?: boolean
          calc_strategy?: string
          category?: string | null
          code?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_function?: string | null
          default_value_column_hint?: string | null
          description?: string | null
          expected_headers?: Json
          id?: string
          label?: string
          requires_tuss_in_sheet?: boolean
          sort_order?: number
          subtype_split_hint?: Json | null
          tuss_codes_extra?: string[]
          tuss_default?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_unmatched_items: {
        Row: {
          access_route: string | null
          agreement_text: string | null
          attendance_character: string | null
          attendance_number: string | null
          convenio_value_totalized: boolean
          created_at: string
          description: string | null
          doctor_document: string | null
          doctor_email: string | null
          doctor_name: string | null
          doctor_role: string | null
          gross_amount: number
          hospital_id: string
          id: string
          ignored_reason: string | null
          match_score: number
          match_suggestion_id: string | null
          match_suggestion_name: string | null
          patient_name: string | null
          payment_id: string
          procedure_amount: number | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_date_has_time: boolean
          procedure_name: string | null
          quantity: number | null
          raw_company_name: string
          raw_data: Json
          resolved_at: string | null
          resolved_by: string | null
          resolved_company_id: string | null
          sector: string | null
          source_file: string | null
          source_file_name: string | null
          specialty: string | null
          status: string
          tipo_linha: string | null
          updated_at: string
        }
        Insert: {
          access_route?: string | null
          agreement_text?: string | null
          attendance_character?: string | null
          attendance_number?: string | null
          convenio_value_totalized?: boolean
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name?: string | null
          doctor_role?: string | null
          gross_amount?: number
          hospital_id: string
          id?: string
          ignored_reason?: string | null
          match_score?: number
          match_suggestion_id?: string | null
          match_suggestion_name?: string | null
          patient_name?: string | null
          payment_id: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_date_has_time?: boolean
          procedure_name?: string | null
          quantity?: number | null
          raw_company_name: string
          raw_data?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_company_id?: string | null
          sector?: string | null
          source_file?: string | null
          source_file_name?: string | null
          specialty?: string | null
          status?: string
          tipo_linha?: string | null
          updated_at?: string
        }
        Update: {
          access_route?: string | null
          agreement_text?: string | null
          attendance_character?: string | null
          attendance_number?: string | null
          convenio_value_totalized?: boolean
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name?: string | null
          doctor_role?: string | null
          gross_amount?: number
          hospital_id?: string
          id?: string
          ignored_reason?: string | null
          match_score?: number
          match_suggestion_id?: string | null
          match_suggestion_name?: string | null
          patient_name?: string | null
          payment_id?: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_date_has_time?: boolean
          procedure_name?: string | null
          quantity?: number | null
          raw_company_name?: string
          raw_data?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_company_id?: string | null
          sector?: string | null
          source_file?: string | null
          source_file_name?: string | null
          specialty?: string | null
          status?: string
          tipo_linha?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_unmatched_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          ai_summary: string | null
          analysis_mode: Database["public"]["Enums"]["payment_analysis_mode"]
          analysis_note: string | null
          analysis_on_behalf_of: string | null
          analysis_registered_by: string | null
          analysis_source: string
          approval_pdf_path: string | null
          approved_at: string | null
          approved_by: string | null
          batch_pattern_id: string | null
          bruto_total: number
          competence_month: string | null
          competence_months: string[]
          competence_regime: string
          confeccao_finalized_at: string | null
          confeccao_finalized_by: string | null
          confeccao_status:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          cost_center_code: string | null
          created_at: string
          created_by: string
          description: string | null
          has_mixed_parecer: boolean
          historico_window_end: string | null
          historico_window_start: string | null
          hospital_id: string
          id: string
          import_mode: string
          is_test: boolean
          items_count: number
          liquido_total: number
          manual_general_attachment_name: string | null
          manual_general_attachment_path: string | null
          mixed_parecer_item_type_id: string | null
          origem: string
          payment_due_date: string | null
          payment_kind: Database["public"]["Enums"]["payment_kind"] | null
          payment_mode: string
          payment_model_id: string | null
          payment_track: Database["public"]["Enums"]["payment_track"] | null
          payment_type: string | null
          payout_breakdown: Json | null
          payout_model_id: string | null
          payout_model_version: number | null
          pool_deduction_id: string | null
          pool_id: string | null
          priority_score: number
          processing_diagnostics: Json | null
          processing_timeout_occurred: boolean | null
          rateio_source: string | null
          rateio_valor_total: number | null
          reference: string
          sectors: string[]
          source_file_path: string | null
          specialties: string[]
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          ai_summary?: string | null
          analysis_mode?: Database["public"]["Enums"]["payment_analysis_mode"]
          analysis_note?: string | null
          analysis_on_behalf_of?: string | null
          analysis_registered_by?: string | null
          analysis_source?: string
          approval_pdf_path?: string | null
          approved_at?: string | null
          approved_by?: string | null
          batch_pattern_id?: string | null
          bruto_total?: number
          competence_month?: string | null
          competence_months?: string[]
          competence_regime?: string
          confeccao_finalized_at?: string | null
          confeccao_finalized_by?: string | null
          confeccao_status?:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          cost_center_code?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          has_mixed_parecer?: boolean
          historico_window_end?: string | null
          historico_window_start?: string | null
          hospital_id: string
          id?: string
          import_mode?: string
          is_test?: boolean
          items_count?: number
          liquido_total?: number
          manual_general_attachment_name?: string | null
          manual_general_attachment_path?: string | null
          mixed_parecer_item_type_id?: string | null
          origem?: string
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_mode?: string
          payment_model_id?: string | null
          payment_track?: Database["public"]["Enums"]["payment_track"] | null
          payment_type?: string | null
          payout_breakdown?: Json | null
          payout_model_id?: string | null
          payout_model_version?: number | null
          pool_deduction_id?: string | null
          pool_id?: string | null
          priority_score?: number
          processing_diagnostics?: Json | null
          processing_timeout_occurred?: boolean | null
          rateio_source?: string | null
          rateio_valor_total?: number | null
          reference: string
          sectors?: string[]
          source_file_path?: string | null
          specialties?: string[]
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          ai_summary?: string | null
          analysis_mode?: Database["public"]["Enums"]["payment_analysis_mode"]
          analysis_note?: string | null
          analysis_on_behalf_of?: string | null
          analysis_registered_by?: string | null
          analysis_source?: string
          approval_pdf_path?: string | null
          approved_at?: string | null
          approved_by?: string | null
          batch_pattern_id?: string | null
          bruto_total?: number
          competence_month?: string | null
          competence_months?: string[]
          competence_regime?: string
          confeccao_finalized_at?: string | null
          confeccao_finalized_by?: string | null
          confeccao_status?:
            | Database["public"]["Enums"]["confeccao_status"]
            | null
          cost_center_code?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          has_mixed_parecer?: boolean
          historico_window_end?: string | null
          historico_window_start?: string | null
          hospital_id?: string
          id?: string
          import_mode?: string
          is_test?: boolean
          items_count?: number
          liquido_total?: number
          manual_general_attachment_name?: string | null
          manual_general_attachment_path?: string | null
          mixed_parecer_item_type_id?: string | null
          origem?: string
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_mode?: string
          payment_model_id?: string | null
          payment_track?: Database["public"]["Enums"]["payment_track"] | null
          payment_type?: string | null
          payout_breakdown?: Json | null
          payout_model_id?: string | null
          payout_model_version?: number | null
          pool_deduction_id?: string | null
          pool_id?: string | null
          priority_score?: number
          processing_diagnostics?: Json | null
          processing_timeout_occurred?: boolean | null
          rateio_source?: string | null
          rateio_valor_total?: number | null
          reference?: string
          sectors?: string[]
          source_file_path?: string | null
          specialties?: string[]
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_batch_pattern_id_fkey"
            columns: ["batch_pattern_id"]
            isOneToOne: false
            referencedRelation: "payment_batch_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_mixed_parecer_item_type_id_fkey"
            columns: ["mixed_parecer_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_model_id_fkey"
            columns: ["payment_model_id"]
            isOneToOne: false
            referencedRelation: "payment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payout_model_id_fkey"
            columns: ["payout_model_id"]
            isOneToOne: false
            referencedRelation: "payout_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_pool_deduction_id_fkey"
            columns: ["pool_deduction_id"]
            isOneToOne: false
            referencedRelation: "pool_deductions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_model_rubrics: {
        Row: {
          convenio_slug: string | null
          convenio_slugs: string[]
          created_at: string
          fixed_pct: number | null
          fixed_value: number | null
          id: string
          incide_sobre: string | null
          kind: string
          label: string
          model_id: string
          notes: string | null
          param_key: string | null
          ref_rubric_order: number | null
          required: boolean
          sort_order: number
          tier_table_id: string | null
          updated_at: string
        }
        Insert: {
          convenio_slug?: string | null
          convenio_slugs?: string[]
          created_at?: string
          fixed_pct?: number | null
          fixed_value?: number | null
          id?: string
          incide_sobre?: string | null
          kind: string
          label: string
          model_id: string
          notes?: string | null
          param_key?: string | null
          ref_rubric_order?: number | null
          required?: boolean
          sort_order: number
          tier_table_id?: string | null
          updated_at?: string
        }
        Update: {
          convenio_slug?: string | null
          convenio_slugs?: string[]
          created_at?: string
          fixed_pct?: number | null
          fixed_value?: number | null
          id?: string
          incide_sobre?: string | null
          kind?: string
          label?: string
          model_id?: string
          notes?: string | null
          param_key?: string | null
          ref_rubric_order?: number | null
          required?: boolean
          sort_order?: number
          tier_table_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_model_rubrics_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "payout_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_model_rubrics_tier_table_id_fkey"
            columns: ["tier_table_id"]
            isOneToOne: false
            referencedRelation: "payout_tier_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_models: {
        Row: {
          active: boolean
          company_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          effective_from: string | null
          effective_to: string | null
          hospital_id: string
          id: string
          name: string
          payment_model_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          hospital_id: string
          id?: string
          name: string
          payment_model_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          hospital_id?: string
          id?: string
          name?: string
          payment_model_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payout_models_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_models_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_models_payment_model_id_fkey"
            columns: ["payment_model_id"]
            isOneToOne: false
            referencedRelation: "payment_models"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_tier_rows: {
        Row: {
          created_at: string
          id: string
          label: string | null
          max_value: number | null
          min_value: number
          output_value: number
          sort_order: number
          tier_table_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          max_value?: number | null
          min_value: number
          output_value: number
          sort_order?: number
          tier_table_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          max_value?: number | null
          min_value?: number
          output_value?: number
          sort_order?: number
          tier_table_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_tier_rows_tier_table_id_fkey"
            columns: ["tier_table_id"]
            isOneToOne: false
            referencedRelation: "payout_tier_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_tier_tables: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          dimension: string
          hospital_id: string | null
          id: string
          name: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension: string
          hospital_id?: string | null
          id?: string
          name: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension?: string
          hospital_id?: string | null
          id?: string
          name?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_tier_tables_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      pendencia_notification_log: {
        Row: {
          channel: string
          created_at: string
          hospital_id: string | null
          id: string
          pendencia_id: string
          priority: string
          reason: string
          recipient_role: string
          recipient_user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          pendencia_id: string
          priority: string
          reason: string
          recipient_role: string
          recipient_user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          pendencia_id?: string
          priority?: string
          reason?: string
          recipient_role?: string
          recipient_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pendencia_notification_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendencia_notification_log_pendencia_id_fkey"
            columns: ["pendencia_id"]
            isOneToOne: false
            referencedRelation: "pendencias"
            referencedColumns: ["id"]
          },
        ]
      }
      pendencia_routing_log: {
        Row: {
          action: string
          actor_id: string | null
          attempted_thread_id: string | null
          created_at: string
          doctor_id: string | null
          hospital_id: string | null
          id: string
          opened_by: string
          pendencia_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          attempted_thread_id?: string | null
          created_at?: string
          doctor_id?: string | null
          hospital_id?: string | null
          id?: string
          opened_by: string
          pendencia_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          attempted_thread_id?: string | null
          created_at?: string
          doctor_id?: string | null
          hospital_id?: string | null
          id?: string
          opened_by?: string
          pendencia_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "pendencia_routing_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      pendencias: {
        Row: {
          agreement_name: string
          assigned_to: string | null
          attendance_number: string | null
          company_id: string
          created_at: string
          created_by_name: string
          created_by_user_id: string | null
          description: string
          doctor_id: string | null
          doctor_name: string
          event_date: string
          event_type: string
          hospital_id: string
          id: string
          opened_by: string
          patient_name: string
          payment_id: string | null
          priority: string
          resolved_at: string | null
          status: string
          subject: string
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          agreement_name: string
          assigned_to?: string | null
          attendance_number?: string | null
          company_id: string
          created_at?: string
          created_by_name: string
          created_by_user_id?: string | null
          description: string
          doctor_id?: string | null
          doctor_name: string
          event_date: string
          event_type: string
          hospital_id: string
          id?: string
          opened_by?: string
          patient_name: string
          payment_id?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          subject: string
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          agreement_name?: string
          assigned_to?: string | null
          attendance_number?: string | null
          company_id?: string
          created_at?: string
          created_by_name?: string
          created_by_user_id?: string | null
          description?: string
          doctor_id?: string | null
          doctor_name?: string
          event_date?: string
          event_type?: string
          hospital_id?: string
          id?: string
          opened_by?: string
          patient_name?: string
          payment_id?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pendencias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendencias_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendencias_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendencias_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "pendencias_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pendencias_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "pendencias_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "company_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_calculation_runs: {
        Row: {
          base_amount: number
          bolo_liquido: number
          captured_item_ids: string[] | null
          competence_month: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          deductions_applied: Json
          error_detail: Json | null
          hospital_id: string
          id: string
          invalidated_at: string | null
          invalidated_reason: string | null
          payment_id: string
          pool_id: string
          quotas: Json
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          snapshot: Json | null
          status: string
        }
        Insert: {
          base_amount: number
          bolo_liquido: number
          captured_item_ids?: string[] | null
          competence_month?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          deductions_applied?: Json
          error_detail?: Json | null
          hospital_id: string
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          payment_id: string
          pool_id: string
          quotas?: Json
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          snapshot?: Json | null
          status?: string
        }
        Update: {
          base_amount?: number
          bolo_liquido?: number
          captured_item_ids?: string[] | null
          competence_month?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          deductions_applied?: Json
          error_detail?: Json | null
          hospital_id?: string
          id?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          payment_id?: string
          pool_id?: string
          quotas?: Json
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          snapshot?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_calculation_runs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_calculation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "pool_calculation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_calculation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "pool_calculation_runs_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_deduction_values: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          attachment_uploaded_at: string | null
          attachment_uploaded_by: string | null
          competence_month: string
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          observacao: string | null
          pool_deduction_id: string
          pool_id: string
          updated_at: string
          updated_by: string | null
          valor: number
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_uploaded_at?: string | null
          attachment_uploaded_by?: string | null
          competence_month: string
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          observacao?: string | null
          pool_deduction_id: string
          pool_id: string
          updated_at?: string
          updated_by?: string | null
          valor: number
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          attachment_uploaded_at?: string | null
          attachment_uploaded_by?: string | null
          competence_month?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          observacao?: string | null
          pool_deduction_id?: string
          pool_id?: string
          updated_at?: string
          updated_by?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_deduction_values_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_deduction_values_pool_deduction_id_fkey"
            columns: ["pool_deduction_id"]
            isOneToOne: false
            referencedRelation: "pool_deductions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_deduction_values_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_deductions: {
        Row: {
          company_id: string | null
          created_at: string
          descricao: string
          hospital_id: string
          id: string
          obrigatoria: boolean
          ordem: number
          pool_id: string
          tipo: string
          updated_at: string
          valor: number | null
          valor_variavel: boolean
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          descricao: string
          hospital_id: string
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pool_id: string
          tipo: string
          updated_at?: string
          valor?: number | null
          valor_variavel?: boolean
        }
        Update: {
          company_id?: string | null
          created_at?: string
          descricao?: string
          hospital_id?: string
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pool_id?: string
          tipo?: string
          updated_at?: string
          valor?: number | null
          valor_variavel?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pool_deductions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_deductions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_deductions_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_item_claims: {
        Row: {
          competence_month: string
          created_at: string
          hospital_id: string
          id: string
          payment_item_id: string
          pool_id: string
          run_id: string | null
        }
        Insert: {
          competence_month: string
          created_at?: string
          hospital_id: string
          id?: string
          payment_item_id: string
          pool_id: string
          run_id?: string | null
        }
        Update: {
          competence_month?: string
          created_at?: string
          hospital_id?: string
          id?: string
          payment_item_id?: string
          pool_id?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_item_claims_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_item_claims_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_item_claims_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "pool_item_claims_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_item_claims_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pool_calculation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_participants: {
        Row: {
          company_id: string | null
          created_at: string
          hospital_id: string
          id: string
          ordem_exibicao: number
          participant_type: string
          percentual: number
          pool_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          hospital_id: string
          id?: string
          ordem_exibicao?: number
          participant_type?: string
          percentual: number
          pool_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          hospital_id?: string
          id?: string
          ordem_exibicao?: number
          participant_type?: string
          percentual?: number
          pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_participants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_participants_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_participants_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pools: {
        Row: {
          ativo: boolean
          base_calculo: string
          created_at: string
          created_by: string | null
          descricao: string | null
          escopo_producao: string
          filtros_captura: Json
          garante_piso: boolean
          hospital_id: string
          id: string
          nome: string
          piso_valor: number | null
          updated_at: string
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          ativo?: boolean
          base_calculo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          escopo_producao?: string
          filtros_captura?: Json
          garante_piso?: boolean
          hospital_id: string
          id?: string
          nome: string
          piso_valor?: number | null
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          ativo?: boolean
          base_calculo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          escopo_producao?: string
          filtros_captura?: Json
          garante_piso?: boolean
          hospital_id?: string
          id?: string
          nome?: string
          piso_valor?: number | null
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pools_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_aliases: {
        Row: {
          alias_normalized: string
          alias_text: string
          canonical_name: string
          created_at: string
          created_by: string | null
          hospital_id: string
          id: string
          source: string | null
        }
        Insert: {
          alias_normalized: string
          alias_text: string
          canonical_name: string
          created_at?: string
          created_by?: string | null
          hospital_id: string
          id?: string
          source?: string | null
        }
        Update: {
          alias_normalized?: string
          alias_text?: string
          canonical_name?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string
          id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedure_aliases_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_classifications: {
        Row: {
          active: boolean
          code_tuss: string
          confidence: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          item_type_id: string | null
          observation: string | null
          sector_classified: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code_tuss: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_type_id?: string | null
          observation?: string | null
          sector_classified?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code_tuss?: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_type_id?: string | null
          observation?: string | null
          sector_classified?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_classifications_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_specialty_map: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          confidence_pct: number | null
          created_at: string
          description: string | null
          medical_specialty: string
          procedure_code: string
          sample_size: number | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          confidence_pct?: number | null
          created_at?: string
          description?: string | null
          medical_specialty: string
          procedure_code: string
          sample_size?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          confidence_pct?: number | null
          created_at?: string
          description?: string | null
          medical_specialty?: string
          procedure_code?: string
          sample_size?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_validation_feedbacks: {
        Row: {
          attendance_number: string | null
          convenio: string | null
          created_at: string
          description: string | null
          doctor_name: string | null
          exclusion_detail: string | null
          exclusion_reason: string | null
          hospital_id: string
          id: string
          kind: string
          patient_name: string | null
          payment_item_id: string | null
          procedure_date: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          validation_id: string
        }
        Insert: {
          attendance_number?: string | null
          convenio?: string | null
          created_at?: string
          description?: string | null
          doctor_name?: string | null
          exclusion_detail?: string | null
          exclusion_reason?: string | null
          hospital_id: string
          id?: string
          kind: string
          patient_name?: string | null
          payment_item_id?: string | null
          procedure_date?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          validation_id: string
        }
        Update: {
          attendance_number?: string | null
          convenio?: string | null
          created_at?: string
          description?: string | null
          doctor_name?: string | null
          exclusion_detail?: string | null
          exclusion_reason?: string | null
          hospital_id?: string
          id?: string
          kind?: string
          patient_name?: string | null
          payment_item_id?: string | null
          procedure_date?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          validation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_validation_feedbacks_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validation_feedbacks_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validation_feedbacks_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "production_validation_feedbacks_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validation_feedbacks_validation_id_fkey"
            columns: ["validation_id"]
            isOneToOne: false
            referencedRelation: "production_validations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_validations: {
        Row: {
          company_id: string
          company_name: string
          confirmed_at: string | null
          confirmed_by_name: string | null
          created_at: string
          expires_at: string
          hospital_id: string
          id: string
          notes: string | null
          payment_id: string
          sent_at: string
          sent_by: string | null
          status: string
          token: string
        }
        Insert: {
          company_id: string
          company_name: string
          confirmed_at?: string | null
          confirmed_by_name?: string | null
          created_at?: string
          expires_at?: string
          hospital_id: string
          id?: string
          notes?: string | null
          payment_id: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          token?: string
        }
        Update: {
          company_id?: string
          company_name?: string
          confirmed_at?: string | null
          confirmed_by_name?: string | null
          created_at?: string
          expires_at?: string
          hospital_id?: string
          id?: string
          notes?: string | null
          payment_id?: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_validations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validations_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "production_validations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_validations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "production_validations_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          birth_date: string | null
          cpf: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string | null
          id: string
          is_senior: boolean
          last_active_hospital_id: string | null
          phone: string | null
          phone_e164: string | null
          preferences: Json
          primary_hospital_id: string | null
          role_title: string | null
          updated_at: string
          whatsapp_opt_in: boolean
          whatsapp_opt_in_at: string | null
        }
        Insert: {
          active?: boolean
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name?: string | null
          id: string
          is_senior?: boolean
          last_active_hospital_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          preferences?: Json
          primary_hospital_id?: string | null
          role_title?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
        }
        Update: {
          active?: boolean
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_senior?: boolean
          last_active_hospital_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          preferences?: Json
          primary_hospital_id?: string | null
          role_title?: string | null
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_active_hospital_id_fkey"
            columns: ["last_active_hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_primary_hospital_id_fkey"
            columns: ["primary_hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_company_mappings: {
        Row: {
          changed_at: string
          changed_by: string | null
          created_at: string
          decision: string
          exacta_company_id: string | null
          hospital_company_norm: string
          hospital_company_raw: string
          id: string
          is_current: boolean
          payment_id: string
          previous_exacta_company_id: string | null
          reason: string | null
          reconciliation_run_id: string | null
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          decision: string
          exacta_company_id?: string | null
          hospital_company_norm: string
          hospital_company_raw: string
          id?: string
          is_current?: boolean
          payment_id: string
          previous_exacta_company_id?: string | null
          reason?: string | null
          reconciliation_run_id?: string | null
          version?: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          decision?: string
          exacta_company_id?: string | null
          hospital_company_norm?: string
          hospital_company_raw?: string
          id?: string
          is_current?: boolean
          payment_id?: string
          previous_exacta_company_id?: string | null
          reason?: string | null
          reconciliation_run_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_company_mappings_exacta_company_id_fkey"
            columns: ["exacta_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_company_mappings_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "reconciliation_company_mappings_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_company_mappings_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "reconciliation_company_mappings_reconciliation_run_id_fkey"
            columns: ["reconciliation_run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          action_at: string | null
          action_by: string | null
          action_note: string | null
          action_taken: string | null
          agreement_text: string | null
          applied_calc_method: string | null
          applied_payment_id: string | null
          applied_payment_item_id: string | null
          applied_rule_label: string | null
          attendance_number: string | null
          carry_glosa_debt_id: string | null
          company_name: string | null
          created_at: string
          diferenca_regra: number | null
          doctor_name: string | null
          hospital_id: string
          ia_obs: string | null
          id: string
          match_diagnostics: Json | null
          patient_name: string | null
          payment_item_id: string | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_name: string | null
          quantity: number | null
          role: string | null
          run_id: string
          status: string
          valor_exacta: number
          valor_hospital: number
          valor_pago_exacta: number | null
          valor_regra: number | null
          valor_repasse_acordo: number | null
        }
        Insert: {
          action_at?: string | null
          action_by?: string | null
          action_note?: string | null
          action_taken?: string | null
          agreement_text?: string | null
          applied_calc_method?: string | null
          applied_payment_id?: string | null
          applied_payment_item_id?: string | null
          applied_rule_label?: string | null
          attendance_number?: string | null
          carry_glosa_debt_id?: string | null
          company_name?: string | null
          created_at?: string
          diferenca_regra?: number | null
          doctor_name?: string | null
          hospital_id: string
          ia_obs?: string | null
          id?: string
          match_diagnostics?: Json | null
          patient_name?: string | null
          payment_item_id?: string | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          role?: string | null
          run_id: string
          status?: string
          valor_exacta?: number
          valor_hospital?: number
          valor_pago_exacta?: number | null
          valor_regra?: number | null
          valor_repasse_acordo?: number | null
        }
        Update: {
          action_at?: string | null
          action_by?: string | null
          action_note?: string | null
          action_taken?: string | null
          agreement_text?: string | null
          applied_calc_method?: string | null
          applied_payment_id?: string | null
          applied_payment_item_id?: string | null
          applied_rule_label?: string | null
          attendance_number?: string | null
          carry_glosa_debt_id?: string | null
          company_name?: string | null
          created_at?: string
          diferenca_regra?: number | null
          doctor_name?: string | null
          hospital_id?: string
          ia_obs?: string | null
          id?: string
          match_diagnostics?: Json | null
          patient_name?: string | null
          payment_item_id?: string | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          role?: string | null
          run_id?: string
          status?: string
          valor_exacta?: number
          valor_hospital?: number
          valor_pago_exacta?: number | null
          valor_regra?: number | null
          valor_repasse_acordo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_action_by_fkey"
            columns: ["action_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "reconciliation_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_applied_payment_id_fkey"
            columns: ["applied_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "reconciliation_items_applied_payment_item_id_fkey"
            columns: ["applied_payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_applied_payment_item_id_fkey"
            columns: ["applied_payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "reconciliation_items_carry_glosa_debt_id_fkey"
            columns: ["carry_glosa_debt_id"]
            isOneToOne: false
            referencedRelation: "glosa_debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_carry_glosa_debt_id_fkey"
            columns: ["carry_glosa_debt_id"]
            isOneToOne: false
            referencedRelation: "v_glosa_debts_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "reconciliation_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          conciliado: number
          created_at: string
          created_by: string | null
          divergencia_valor: number
          file_name: string | null
          hospital_id: string
          id: string
          payment_id: string
          risco_mais: number
          risco_menos: number
          so_exacta: number
          so_hospital: number
          status: string
          total_items: number
          valor_divergente: number
        }
        Insert: {
          conciliado?: number
          created_at?: string
          created_by?: string | null
          divergencia_valor?: number
          file_name?: string | null
          hospital_id: string
          id?: string
          payment_id: string
          risco_mais?: number
          risco_menos?: number
          so_exacta?: number
          so_hospital?: number
          status?: string
          total_items?: number
          valor_divergente?: number
        }
        Update: {
          conciliado?: number
          created_at?: string
          created_by?: string | null
          divergencia_valor?: number
          file_name?: string | null
          hospital_id?: string
          id?: string
          payment_id?: string
          risco_mais?: number
          risco_menos?: number
          so_exacta?: number
          so_hospital?: number
          status?: string
          total_items?: number
          valor_divergente?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "reconciliation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_runs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      reference_table_items: {
        Row: {
          amount: number | null
          aux_count: number | null
          code: string
          created_at: string
          description: string | null
          hospital_id: string | null
          id: string
          notes: string | null
          package_amount: number | null
          package_id: string | null
          port: string | null
          port_multiplier: number
          reference_table_id: string
          role: string | null
          tuss_codes: string[]
        }
        Insert: {
          amount?: number | null
          aux_count?: number | null
          code: string
          created_at?: string
          description?: string | null
          hospital_id?: string | null
          id?: string
          notes?: string | null
          package_amount?: number | null
          package_id?: string | null
          port?: string | null
          port_multiplier?: number
          reference_table_id: string
          role?: string | null
          tuss_codes?: string[]
        }
        Update: {
          amount?: number | null
          aux_count?: number | null
          code?: string
          created_at?: string
          description?: string | null
          hospital_id?: string | null
          id?: string
          notes?: string | null
          package_amount?: number | null
          package_id?: string | null
          port?: string | null
          port_multiplier?: number
          reference_table_id?: string
          role?: string | null
          tuss_codes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "reference_table_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_table_items_reference_table_id_fkey"
            columns: ["reference_table_id"]
            isOneToOne: false
            referencedRelation: "reference_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_table_port_values: {
        Row: {
          amount: number
          created_at: string
          hospital_id: string | null
          id: string
          port: string
          reference_table_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          hospital_id?: string | null
          id?: string
          port: string
          reference_table_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          hospital_id?: string | null
          id?: string
          port?: string
          reference_table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_table_port_values_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_table_port_values_reference_table_id_fkey"
            columns: ["reference_table_id"]
            isOneToOne: false
            referencedRelation: "reference_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_tables: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          exclusion_severity: string
          hospital_id: string | null
          id: string
          kind: Database["public"]["Enums"]["reference_table_kind"]
          name: string
          notes: string | null
          package_apply_auxiliaries: boolean
          package_apply_intl_insurance: boolean
          package_apply_particular: boolean
          package_only_main_surgeon: boolean
          purpose: string
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          year: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          exclusion_severity?: string
          hospital_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reference_table_kind"]
          name: string
          notes?: string | null
          package_apply_auxiliaries?: boolean
          package_apply_intl_insurance?: boolean
          package_apply_particular?: boolean
          package_only_main_surgeon?: boolean
          purpose?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          year?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          exclusion_severity?: string
          hospital_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reference_table_kind"]
          name?: string
          notes?: string | null
          package_apply_auxiliaries?: boolean
          package_apply_intl_insurance?: boolean
          package_apply_particular?: boolean
          package_only_main_surgeon?: boolean
          purpose?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_tables_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      retroactive_reconciliation_items: {
        Row: {
          attendance: string | null
          claimed_amount: number | null
          claimed_quantity: number | null
          classification: Database["public"]["Enums"]["retro_recon_classification"]
          classification_reason: string | null
          company_id: string | null
          created_at: string
          excluded_at: string | null
          excluded_by: string | null
          excluir_do_encaminhamento: boolean
          exclusion_note: string | null
          exclusion_reason:
            | Database["public"]["Enums"]["retro_exclusion_reason"]
            | null
          expected_amount: number | null
          function_label: string | null
          gap_amount: number | null
          generated_adjustment_id: string | null
          id: string
          matched_payment_date: string | null
          matched_payment_period: unknown
          paid_amount: number | null
          paid_quantity: number | null
          patient_name: string | null
          payment_id: string | null
          payment_item_id: string | null
          procedure_date: string | null
          procedure_name: string | null
          raw: Json
          reconciliation_id: string
          retroactive_target_company_id: string | null
          source: string
          target_reassign_reason: string | null
          target_reassigned_at: string | null
          target_reassigned_by: string | null
          tuss_code: string | null
          updated_at: string
        }
        Insert: {
          attendance?: string | null
          claimed_amount?: number | null
          claimed_quantity?: number | null
          classification?: Database["public"]["Enums"]["retro_recon_classification"]
          classification_reason?: string | null
          company_id?: string | null
          created_at?: string
          excluded_at?: string | null
          excluded_by?: string | null
          excluir_do_encaminhamento?: boolean
          exclusion_note?: string | null
          exclusion_reason?:
            | Database["public"]["Enums"]["retro_exclusion_reason"]
            | null
          expected_amount?: number | null
          function_label?: string | null
          gap_amount?: number | null
          generated_adjustment_id?: string | null
          id?: string
          matched_payment_date?: string | null
          matched_payment_period?: unknown
          paid_amount?: number | null
          paid_quantity?: number | null
          patient_name?: string | null
          payment_id?: string | null
          payment_item_id?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          raw?: Json
          reconciliation_id: string
          retroactive_target_company_id?: string | null
          source?: string
          target_reassign_reason?: string | null
          target_reassigned_at?: string | null
          target_reassigned_by?: string | null
          tuss_code?: string | null
          updated_at?: string
        }
        Update: {
          attendance?: string | null
          claimed_amount?: number | null
          claimed_quantity?: number | null
          classification?: Database["public"]["Enums"]["retro_recon_classification"]
          classification_reason?: string | null
          company_id?: string | null
          created_at?: string
          excluded_at?: string | null
          excluded_by?: string | null
          excluir_do_encaminhamento?: boolean
          exclusion_note?: string | null
          exclusion_reason?:
            | Database["public"]["Enums"]["retro_exclusion_reason"]
            | null
          expected_amount?: number | null
          function_label?: string | null
          gap_amount?: number | null
          generated_adjustment_id?: string | null
          id?: string
          matched_payment_date?: string | null
          matched_payment_period?: unknown
          paid_amount?: number | null
          paid_quantity?: number | null
          patient_name?: string | null
          payment_id?: string | null
          payment_item_id?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          raw?: Json
          reconciliation_id?: string
          retroactive_target_company_id?: string | null
          source?: string
          target_reassign_reason?: string | null
          target_reassigned_at?: string | null
          target_reassigned_by?: string | null
          tuss_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retroactive_reconciliation_it_retroactive_target_company_i_fkey"
            columns: ["retroactive_target_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "retroactive_reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "retroactive_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      retroactive_reconciliations: {
        Row: {
          adjustment_ids: string[]
          analysis_mode: string | null
          company_id: string | null
          concluded_at: string | null
          cost_center_code: string | null
          created_at: string
          created_by: string | null
          doctor_id: string | null
          hospital_id: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          source_payment_id: string | null
          status: Database["public"]["Enums"]["retro_recon_status"]
          summary: Json
          title: string | null
          updated_at: string
        }
        Insert: {
          adjustment_ids?: string[]
          analysis_mode?: string | null
          company_id?: string | null
          concluded_at?: string | null
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          source_payment_id?: string | null
          status?: Database["public"]["Enums"]["retro_recon_status"]
          summary?: Json
          title?: string | null
          updated_at?: string
        }
        Update: {
          adjustment_ids?: string[]
          analysis_mode?: string | null
          company_id?: string | null
          concluded_at?: string | null
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          source_payment_id?: string | null
          status?: Database["public"]["Enums"]["retro_recon_status"]
          summary?: Json
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retroactive_reconciliations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliations_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliations_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "retroactive_reconciliations_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retroactive_reconciliations_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      rule_calculations: {
        Row: {
          acrescimo_pct: number | null
          adicional_fds_pct: number | null
          adicional_feriado_pct: number | null
          adicional_noturno_pct: number | null
          adicional_urgencia_pct: number | null
          agreement_aliases: string[] | null
          agreement_match_mode: string | null
          allowed_access_routes: string[] | null
          application_unit: string
          apply_access_route: boolean
          aux_first_pct: number | null
          aux_second_pct: number | null
          auxiliary_pct: number | null
          bonus_amount: number | null
          bonus_pct: number | null
          calculation_type: Database["public"]["Enums"]["rule_calculation_type"]
          code_match_mode: string
          contagia_atendimento: boolean
          context_conditions: Json
          convenio_percentage: number | null
          created_at: string
          deflator_pct: number | null
          doctor_roles: string[] | null
          elective_mode: string
          extras_codes: string[] | null
          fixed_amount: number | null
          fixed_amount_by_role: Json | null
          force_totalized: boolean | null
          has_conditions: boolean | null
          hospital_id: string
          id: string
          include_auxiliaries: boolean
          includes_holidays: boolean
          instrumentador_pct: number | null
          is_catch_all: boolean
          item_type_id: string | null
          label: string | null
          match_by_specialty: boolean
          multiplier: number | null
          noturno_fim: string | null
          noturno_inicio: string | null
          package_amount: number | null
          package_auxiliaries_included: boolean
          package_included_codes: string[] | null
          package_main_code: string | null
          package_opinions_count: boolean
          package_roles_distribution: Json | null
          package_subtype: string | null
          package_visits_count: boolean
          piso_escopo: string | null
          piso_habilitado: boolean
          piso_por_funcao: Json
          piso_valor_padrao: number | null
          procedure_codes: string[] | null
          procedure_keywords: string[] | null
          reference_table_id: string | null
          repasse_pct: number | null
          rule_id: string
          sectors: string[] | null
          sort_order: number
          special_case_filter: string[] | null
          specialties: string[] | null
          target_amount: number | null
          time_end: string | null
          time_mode: string
          time_start: string | null
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          acrescimo_pct?: number | null
          adicional_fds_pct?: number | null
          adicional_feriado_pct?: number | null
          adicional_noturno_pct?: number | null
          adicional_urgencia_pct?: number | null
          agreement_aliases?: string[] | null
          agreement_match_mode?: string | null
          allowed_access_routes?: string[] | null
          application_unit?: string
          apply_access_route?: boolean
          aux_first_pct?: number | null
          aux_second_pct?: number | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
          code_match_mode?: string
          contagia_atendimento?: boolean
          context_conditions?: Json
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          fixed_amount_by_role?: Json | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
          hospital_id: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          is_catch_all?: boolean
          item_type_id?: string | null
          label?: string | null
          match_by_specialty?: boolean
          multiplier?: number | null
          noturno_fim?: string | null
          noturno_inicio?: string | null
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_roles_distribution?: Json | null
          package_subtype?: string | null
          package_visits_count?: boolean
          piso_escopo?: string | null
          piso_habilitado?: boolean
          piso_por_funcao?: Json
          piso_valor_padrao?: number | null
          procedure_codes?: string[] | null
          procedure_keywords?: string[] | null
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_id: string
          sectors?: string[] | null
          sort_order?: number
          special_case_filter?: string[] | null
          specialties?: string[] | null
          target_amount?: number | null
          time_end?: string | null
          time_mode?: string
          time_start?: string | null
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          acrescimo_pct?: number | null
          adicional_fds_pct?: number | null
          adicional_feriado_pct?: number | null
          adicional_noturno_pct?: number | null
          adicional_urgencia_pct?: number | null
          agreement_aliases?: string[] | null
          agreement_match_mode?: string | null
          allowed_access_routes?: string[] | null
          application_unit?: string
          apply_access_route?: boolean
          aux_first_pct?: number | null
          aux_second_pct?: number | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
          code_match_mode?: string
          contagia_atendimento?: boolean
          context_conditions?: Json
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          fixed_amount_by_role?: Json | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
          hospital_id?: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          is_catch_all?: boolean
          item_type_id?: string | null
          label?: string | null
          match_by_specialty?: boolean
          multiplier?: number | null
          noturno_fim?: string | null
          noturno_inicio?: string | null
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_roles_distribution?: Json | null
          package_subtype?: string | null
          package_visits_count?: boolean
          piso_escopo?: string | null
          piso_habilitado?: boolean
          piso_por_funcao?: Json
          piso_valor_padrao?: number | null
          procedure_codes?: string[] | null
          procedure_keywords?: string[] | null
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_id?: string
          sectors?: string[] | null
          sort_order?: number
          special_case_filter?: string[] | null
          specialties?: string[] | null
          target_amount?: number | null
          time_end?: string | null
          time_mode?: string
          time_start?: string | null
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "rule_calculations_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_calculations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_calculations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules_pending_doctors_summary"
            referencedColumns: ["rule_id"]
          },
        ]
      }
      rule_snapshots: {
        Row: {
          actor_id: string | null
          calc_count: number
          created_at: string
          hospital_id: string
          id: string
          payload: Json
          reason: string
          rule_id: string
        }
        Insert: {
          actor_id?: string | null
          calc_count?: number
          created_at?: string
          hospital_id: string
          id?: string
          payload: Json
          reason: string
          rule_id: string
        }
        Update: {
          actor_id?: string | null
          calc_count?: number
          created_at?: string
          hospital_id?: string
          id?: string
          payload?: Json
          reason?: string
          rule_id?: string
        }
        Relationships: []
      }
      rule_suggestions: {
        Row: {
          company_group_id: string | null
          context: Json
          created_at: string
          created_rule_id: string | null
          doctor_id: string | null
          doctor_name: string | null
          hospital_id: string
          id: string
          justification: string
          occurrences: number
          payment_id: string | null
          procedure_code: string | null
          procedure_description: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sample_item_ids: string[]
          status: Database["public"]["Enums"]["rule_suggestion_status"]
          suggested_by: string
          updated_at: string
        }
        Insert: {
          company_group_id?: string | null
          context?: Json
          created_at?: string
          created_rule_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          hospital_id: string
          id?: string
          justification: string
          occurrences?: number
          payment_id?: string | null
          procedure_code?: string | null
          procedure_description?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_item_ids?: string[]
          status?: Database["public"]["Enums"]["rule_suggestion_status"]
          suggested_by: string
          updated_at?: string
        }
        Update: {
          company_group_id?: string | null
          context?: Json
          created_at?: string
          created_rule_id?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          hospital_id?: string
          id?: string
          justification?: string
          occurrences?: number
          payment_id?: string | null
          procedure_code?: string | null
          procedure_description?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_item_ids?: string[]
          status?: Database["public"]["Enums"]["rule_suggestion_status"]
          suggested_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_suggestions_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_suggestions_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "rule_suggestions_created_rule_id_fkey"
            columns: ["created_rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_suggestions_created_rule_id_fkey"
            columns: ["created_rule_id"]
            isOneToOne: false
            referencedRelation: "rules_pending_doctors_summary"
            referencedColumns: ["rule_id"]
          },
          {
            foreignKeyName: "rule_suggestions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_suggestions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_suggestions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rule_suggestions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_suggestions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      rules: {
        Row: {
          active: boolean
          agreement_match_mode: string
          agreement_name: string | null
          allows_authorized_exception: boolean
          apply_access_route: boolean
          aux_first_pct: number | null
          aux_second_pct: number | null
          auxiliary_pct: number | null
          bonus_amount: number | null
          bonus_pct: number | null
          calculation_mode: string
          calculation_type: Database["public"]["Enums"]["rule_calculation_type"]
          code: string
          convenio_percentage: number | null
          created_at: string
          created_by: string | null
          deflator_pct: number | null
          description: string | null
          elective_mode: string
          exception_table_ids: string[]
          exclusion_reason: string | null
          extras_codes: string[] | null
          fixed_amount: number | null
          force_totalized: boolean | null
          group_company_links: Json
          group_doctors: Json
          has_conditions: boolean | null
          hospital_id: string
          id: string
          include_auxiliaries: boolean
          includes_holidays: boolean
          instrumentador_pct: number | null
          item_type_id: string | null
          limiar_alerta_tipo:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor: number | null
          limiar_bloqueio_tipo:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor: number | null
          match_by_specialty: boolean
          minimo_garantido_ativo: boolean
          minimo_garantido_base: string | null
          minimo_garantido_escopo: string | null
          minimo_garantido_periodicidade: string | null
          minimo_garantido_valor: number | null
          multiplier: number | null
          name: string
          package_amount: number | null
          package_auxiliaries_included: boolean
          package_included_codes: string[] | null
          package_main_code: string | null
          package_opinions_count: boolean
          package_subtype: string | null
          package_visits_count: boolean
          prevent_external_fallback: boolean
          reference_table_id: string | null
          repasse_pct: number | null
          rule_text: string
          scope: Database["public"]["Enums"]["rule_scope"]
          severity: Database["public"]["Enums"]["rule_severity"]
          special_case_filter: string[] | null
          target_amount: number | null
          target_company_id: string | null
          target_doctor_id: string | null
          target_identifier: string | null
          target_name: string | null
          target_type: Database["public"]["Enums"]["rule_target_type"] | null
          time_end: string | null
          time_mode: string
          time_start: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          weekdays: number[]
        }
        Insert: {
          active?: boolean
          agreement_match_mode?: string
          agreement_name?: string | null
          allows_authorized_exception?: boolean
          apply_access_route?: boolean
          aux_first_pct?: number | null
          aux_second_pct?: number | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          calculation_mode?: string
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
          code: string
          convenio_percentage?: number | null
          created_at?: string
          created_by?: string | null
          deflator_pct?: number | null
          description?: string | null
          elective_mode?: string
          exception_table_ids?: string[]
          exclusion_reason?: string | null
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          group_company_links?: Json
          group_doctors?: Json
          has_conditions?: boolean | null
          hospital_id: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          item_type_id?: string | null
          limiar_alerta_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor?: number | null
          limiar_bloqueio_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor?: number | null
          match_by_specialty?: boolean
          minimo_garantido_ativo?: boolean
          minimo_garantido_base?: string | null
          minimo_garantido_escopo?: string | null
          minimo_garantido_periodicidade?: string | null
          minimo_garantido_valor?: number | null
          multiplier?: number | null
          name: string
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          prevent_external_fallback?: boolean
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_text: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          severity?: Database["public"]["Enums"]["rule_severity"]
          special_case_filter?: string[] | null
          target_amount?: number | null
          target_company_id?: string | null
          target_doctor_id?: string | null
          target_identifier?: string | null
          target_name?: string | null
          target_type?: Database["public"]["Enums"]["rule_target_type"] | null
          time_end?: string | null
          time_mode?: string
          time_start?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          weekdays?: number[]
        }
        Update: {
          active?: boolean
          agreement_match_mode?: string
          agreement_name?: string | null
          allows_authorized_exception?: boolean
          apply_access_route?: boolean
          aux_first_pct?: number | null
          aux_second_pct?: number | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          calculation_mode?: string
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
          code?: string
          convenio_percentage?: number | null
          created_at?: string
          created_by?: string | null
          deflator_pct?: number | null
          description?: string | null
          elective_mode?: string
          exception_table_ids?: string[]
          exclusion_reason?: string | null
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          group_company_links?: Json
          group_doctors?: Json
          has_conditions?: boolean | null
          hospital_id?: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          item_type_id?: string | null
          limiar_alerta_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor?: number | null
          limiar_bloqueio_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor?: number | null
          match_by_specialty?: boolean
          minimo_garantido_ativo?: boolean
          minimo_garantido_base?: string | null
          minimo_garantido_escopo?: string | null
          minimo_garantido_periodicidade?: string | null
          minimo_garantido_valor?: number | null
          multiplier?: number | null
          name?: string
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          prevent_external_fallback?: boolean
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_text?: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          severity?: Database["public"]["Enums"]["rule_severity"]
          special_case_filter?: string[] | null
          target_amount?: number | null
          target_company_id?: string | null
          target_doctor_id?: string | null
          target_identifier?: string | null
          target_name?: string | null
          target_type?: Database["public"]["Enums"]["rule_target_type"] | null
          time_end?: string | null
          time_mode?: string
          time_start?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "rules_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_reference_table_fk"
            columns: ["reference_table_id"]
            isOneToOne: false
            referencedRelation: "reference_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_target_company_id_fkey"
            columns: ["target_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_target_doctor_id_fkey"
            columns: ["target_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      sector_aliases: {
        Row: {
          alias_normalized: string | null
          alias_text: string
          created_at: string
          created_by: string | null
          hospital_id: string | null
          id: string
          sector_slug: string
          source: string
          state_uf: string | null
        }
        Insert: {
          alias_normalized?: string | null
          alias_text: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string | null
          id?: string
          sector_slug: string
          source?: string
          state_uf?: string | null
        }
        Update: {
          alias_normalized?: string | null
          alias_text?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: string | null
          id?: string
          sector_slug?: string
          source?: string
          state_uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sector_aliases_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_aliases_sector_slug_fkey"
            columns: ["sector_slug"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["slug"]
          },
        ]
      }
      sector_link_suggestions: {
        Row: {
          ai_reasoning: string | null
          confidence: string | null
          context_jsonb: Json | null
          created_at: string
          detected_value: string | null
          detected_value_normalized: string | null
          id: string
          matched_sector_slug: string | null
          raw_snippet: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number | null
          sector_slug: string | null
          source: string
          source_field: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_sector_slug?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          sector_slug?: string | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          confidence?: string | null
          context_jsonb?: Json | null
          created_at?: string
          detected_value?: string | null
          detected_value_normalized?: string | null
          id?: string
          matched_sector_slug?: string | null
          raw_snippet?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          sector_slug?: string | null
          source?: string
          source_field?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sectors: {
        Row: {
          active: boolean
          aliases: string[]
          classification: string | null
          code: string
          created_at: string
          created_by_user_id: string | null
          deactivated_at: string | null
          hospital_id: string | null
          name: string
          notes: string | null
          pending_admin_review: boolean
          pending_review_note: string | null
          slug: string
          sort_order: number
          state_uf: string | null
          tasy_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          classification?: string | null
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          deactivated_at?: string | null
          hospital_id?: string | null
          name: string
          notes?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          slug: string
          sort_order?: number
          state_uf?: string | null
          tasy_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          classification?: string | null
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          deactivated_at?: string | null
          hospital_id?: string | null
          name?: string
          notes?: string | null
          pending_admin_review?: boolean
          pending_review_note?: string | null
          slug?: string
          sort_order?: number
          state_uf?: string | null
          tasy_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sectors_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_column_templates: {
        Row: {
          created_at: string
          created_by: string | null
          header_signature: string
          headers: Json
          hospital_id: string | null
          id: string
          last_used_at: string | null
          mapping: Json
          name: string
          updated_at: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          header_signature: string
          headers?: Json
          hospital_id?: string | null
          id?: string
          last_used_at?: string | null
          mapping?: Json
          name: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          header_signature?: string
          headers?: Json
          hospital_id?: string | null
          id?: string
          last_used_at?: string | null
          mapping?: Json
          name?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sheet_column_templates_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      simulacao_cenario: {
        Row: {
          ano_referencia: number | null
          created_at: string
          criado_por: string | null
          custo_hm_aurum: number | null
          custo_sala_minuto: number | null
          delta_margem: number | null
          descricao: string | null
          dobra_cbhpm: number | null
          hospital_id: string
          id: string
          margem_aurum_original: number | null
          margem_simulada: number | null
          medico_nome: string | null
          nome: string
          parametros_json: Json | null
          pct_margem_aurum_original: number | null
          pct_margem_simulada: number | null
          pct_repasse: number | null
          procedimento_nome: string | null
          repasse_real_exacta: number | null
          repasse_simulado: number | null
          resultado_json: Json | null
          tipo: string
          updated_at: string
          via_acesso_pct: number | null
          volume_estimado: number | null
        }
        Insert: {
          ano_referencia?: number | null
          created_at?: string
          criado_por?: string | null
          custo_hm_aurum?: number | null
          custo_sala_minuto?: number | null
          delta_margem?: number | null
          descricao?: string | null
          dobra_cbhpm?: number | null
          hospital_id: string
          id?: string
          margem_aurum_original?: number | null
          margem_simulada?: number | null
          medico_nome?: string | null
          nome: string
          parametros_json?: Json | null
          pct_margem_aurum_original?: number | null
          pct_margem_simulada?: number | null
          pct_repasse?: number | null
          procedimento_nome?: string | null
          repasse_real_exacta?: number | null
          repasse_simulado?: number | null
          resultado_json?: Json | null
          tipo?: string
          updated_at?: string
          via_acesso_pct?: number | null
          volume_estimado?: number | null
        }
        Update: {
          ano_referencia?: number | null
          created_at?: string
          criado_por?: string | null
          custo_hm_aurum?: number | null
          custo_sala_minuto?: number | null
          delta_margem?: number | null
          descricao?: string | null
          dobra_cbhpm?: number | null
          hospital_id?: string
          id?: string
          margem_aurum_original?: number | null
          margem_simulada?: number | null
          medico_nome?: string | null
          nome?: string
          parametros_json?: Json | null
          pct_margem_aurum_original?: number | null
          pct_margem_simulada?: number | null
          pct_repasse?: number | null
          procedimento_nome?: string | null
          repasse_real_exacta?: number | null
          repasse_simulado?: number | null
          resultado_json?: Json | null
          tipo?: string
          updated_at?: string
          via_acesso_pct?: number | null
          volume_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulacao_cenario_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_settings: {
        Row: {
          active: boolean
          business_days: number
          created_at: string
          hospital_id: string | null
          id: string
          severity: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          warning_pct: number
        }
        Insert: {
          active?: boolean
          business_days?: number
          created_at?: string
          hospital_id?: string | null
          id?: string
          severity?: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          warning_pct?: number
        }
        Update: {
          active?: boolean
          business_days?: number
          created_at?: string
          hospital_id?: string | null
          id?: string
          severity?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          warning_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "sla_settings_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      special_case_marks: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          attendance_number: string
          created_at: string
          doctor_id: string | null
          hospital_id: string
          id: string
          item_id: string | null
          justification: string | null
          marked_at: string
          marked_by: string | null
          marked_by_portal_user: string | null
          origin: Database["public"]["Enums"]["special_case_origin"]
          payment_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          retro_adjustment_id: string | null
          retro_applied_at: string | null
          retro_applied_by: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          special_case_type_code: string
          status: Database["public"]["Enums"]["special_case_status"]
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attendance_number: string
          created_at?: string
          doctor_id?: string | null
          hospital_id: string
          id?: string
          item_id?: string | null
          justification?: string | null
          marked_at?: string
          marked_by?: string | null
          marked_by_portal_user?: string | null
          origin: Database["public"]["Enums"]["special_case_origin"]
          payment_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          retro_adjustment_id?: string | null
          retro_applied_at?: string | null
          retro_applied_by?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          special_case_type_code: string
          status?: Database["public"]["Enums"]["special_case_status"]
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attendance_number?: string
          created_at?: string
          doctor_id?: string | null
          hospital_id?: string
          id?: string
          item_id?: string | null
          justification?: string | null
          marked_at?: string
          marked_by?: string | null
          marked_by_portal_user?: string | null
          origin?: Database["public"]["Enums"]["special_case_origin"]
          payment_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          retro_adjustment_id?: string | null
          retro_applied_at?: string | null
          retro_applied_by?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          special_case_type_code?: string
          status?: Database["public"]["Enums"]["special_case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_case_marks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_case_marks_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_case_marks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_case_marks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "special_case_marks_marked_by_portal_user_fkey"
            columns: ["marked_by_portal_user"]
            isOneToOne: false
            referencedRelation: "doctor_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_case_marks_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "special_case_marks_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_case_marks_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "special_case_marks_retro_adjustment_id_fkey"
            columns: ["retro_adjustment_id"]
            isOneToOne: false
            referencedRelation: "company_financial_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      special_case_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          hospital_id: string | null
          id: string
          label: string
          requires_justification: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          hospital_id?: string | null
          id?: string
          label: string
          requires_justification?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          hospital_id?: string | null
          id?: string
          label?: string
          requires_justification?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_case_types_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      specialty_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          hospital_id: string | null
          id: string
          new_active: boolean | null
          new_name: string | null
          old_active: boolean | null
          old_name: string | null
          specialty_code: string
          specialty_id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          hospital_id?: string | null
          id?: string
          new_active?: boolean | null
          new_name?: string | null
          old_active?: boolean | null
          old_name?: string | null
          specialty_code: string
          specialty_id: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          hospital_id?: string | null
          id?: string
          new_active?: boolean | null
          new_name?: string | null
          old_active?: boolean | null
          old_name?: string | null
          specialty_code?: string
          specialty_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "specialty_audit_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      status_anomalies: {
        Row: {
          context: Json
          created_at: string
          hospital_id: string
          id: string
          kind: string
          payment_id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"] | null
          triggered_by: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          hospital_id: string
          id?: string
          kind: string
          payment_id: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
          triggered_by?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          hospital_id?: string
          id?: string
          kind?: string
          payment_id?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_anomalies_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_anomalies_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "status_anomalies_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_anomalies_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      system_announcements: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          dismissible: boolean
          ends_at: string | null
          id: string
          message: string
          severity: string
          starts_at: string
          target_roles: string[]
          title: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          dismissible?: boolean
          ends_at?: string | null
          id?: string
          message: string
          severity?: string
          starts_at?: string
          target_roles?: string[]
          title?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          dismissible?: boolean
          ends_at?: string | null
          id?: string
          message?: string
          severity?: string
          starts_at?: string
          target_roles?: string[]
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_configurations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      system_parameter_defs: {
        Row: {
          category: string
          created_at: string
          description: string | null
          json_schema: Json
          key: string
          label: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          json_schema?: Json
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          json_schema?: Json
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      system_parameter_overrides: {
        Row: {
          active: boolean
          convenio_slug: string | null
          created_at: string
          def_key: string
          hospital_id: string
          id: string
          note: string | null
          priority: number | null
          specialty: string | null
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          active?: boolean
          convenio_slug?: string | null
          created_at?: string
          def_key: string
          hospital_id: string
          id?: string
          note?: string | null
          priority?: number | null
          specialty?: string | null
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          active?: boolean
          convenio_slug?: string | null
          created_at?: string
          def_key?: string
          hospital_id?: string
          id?: string
          note?: string | null
          priority?: number | null
          specialty?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_parameter_overrides_convenio_slug_fkey"
            columns: ["convenio_slug"]
            isOneToOne: false
            referencedRelation: "convenios"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "system_parameter_overrides_def_key_fkey"
            columns: ["def_key"]
            isOneToOne: false
            referencedRelation: "system_parameter_defs"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "system_parameter_overrides_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      system_releases: {
        Row: {
          changelog: string
          created_at: string
          id: string
          is_current: boolean
          published: boolean
          release_type: string
          released_at: string
          released_by: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          changelog: string
          created_at?: string
          id?: string
          is_current?: boolean
          published?: boolean
          release_type?: string
          released_at?: string
          released_by?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          changelog?: string
          created_at?: string
          id?: string
          is_current?: boolean
          published?: boolean
          release_type?: string
          released_at?: string
          released_by?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      thread_view_log: {
        Row: {
          id: string
          thread_id: string
          unread_before: number | null
          viewed_at: string
          viewer_role: string
          viewer_user_id: string
        }
        Insert: {
          id?: string
          thread_id: string
          unread_before?: number | null
          viewed_at?: string
          viewer_role: string
          viewer_user_id: string
        }
        Update: {
          id?: string
          thread_id?: string
          unread_before?: number | null
          viewed_at?: string
          viewer_role?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_view_log_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "company_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      tuss_audit_overrides: {
        Row: {
          created_at: string
          id: string
          justification: string | null
          payment_item_id: string
          resolved_at: string
          resolved_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          justification?: string | null
          payment_item_id: string
          resolved_at?: string
          resolved_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          justification?: string | null
          payment_item_id?: string
          resolved_at?: string
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tuss_audit_overrides_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: true
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuss_audit_overrides_payment_item_id_fkey"
            columns: ["payment_item_id"]
            isOneToOne: true
            referencedRelation: "v_payment_items_registration_issues"
            referencedColumns: ["item_id"]
          },
        ]
      }
      tuss_procedure_names: {
        Row: {
          canonical_name: string
          categoria_funcional: string | null
          code: string
          created_at: string | null
          grupo_cbhpm: string | null
          source: string | null
        }
        Insert: {
          canonical_name: string
          categoria_funcional?: string | null
          code: string
          created_at?: string | null
          grupo_cbhpm?: string | null
          source?: string | null
        }
        Update: {
          canonical_name?: string
          categoria_funcional?: string | null
          code?: string
          created_at?: string | null
          grupo_cbhpm?: string | null
          source?: string | null
        }
        Relationships: []
      }
      user_active_hospital: {
        Row: {
          hospital_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          hospital_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          hospital_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_hospital_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_company_note_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          group_id: string
          id: string
          mime_type: string | null
          payment_id: string
          size_bytes: number
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          group_id: string
          id?: string
          mime_type?: string | null
          payment_id: string
          size_bytes?: number
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          group_id?: string
          id?: string
          mime_type?: string | null
          payment_id?: string
          size_bytes?: number
          user_id?: string
        }
        Relationships: []
      }
      user_company_notes: {
        Row: {
          created_at: string
          group_id: string
          id: string
          marker: Database["public"]["Enums"]["user_company_marker"] | null
          note: string
          payment_id: string
          updated_at: string
          user_id: string
          waiting_info: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          marker?: Database["public"]["Enums"]["user_company_marker"] | null
          note?: string
          payment_id: string
          updated_at?: string
          user_id: string
          waiting_info?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          marker?: Database["public"]["Enums"]["user_company_marker"] | null
          note?: string
          payment_id?: string
          updated_at?: string
          user_id?: string
          waiting_info?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_company_notes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "payment_company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_company_notes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_group_rule_totals"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "user_company_notes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "user_company_notes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_company_notes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      user_hospitals: {
        Row: {
          created_at: string
          hospital_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          hospital_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          hospital_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_hospitals_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_settings: {
        Row: {
          created_at: string | null
          email_enabled: boolean
          event_type: string
          id: string
          updated_at: string | null
          user_id: string
          whatsapp_enabled: boolean
        }
        Insert: {
          created_at?: string | null
          email_enabled?: boolean
          event_type: string
          id?: string
          updated_at?: string | null
          user_id: string
          whatsapp_enabled?: boolean
        }
        Update: {
          created_at?: string | null
          email_enabled?: boolean
          event_type?: string
          id?: string
          updated_at?: string | null
          user_id?: string
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_states: {
        Row: {
          granted_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          state_uf: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          state_uf: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          state_uf?: string
          user_id?: string
        }
        Relationships: []
      }
      validation_rules: {
        Row: {
          action: Database["public"]["Enums"]["validation_action"]
          active: boolean
          allows_authorized_exception: boolean
          assistance_group_id: string | null
          company_ids: string[]
          created_at: string
          created_by: string | null
          description: string | null
          doctors: Json
          hospital_id: string
          id: string
          kind: Database["public"]["Enums"]["validation_kind"]
          name: string
          params: Json
          payment_types: string[]
          require_justification: boolean
          scope_global: boolean
          sectors: string[]
          severity: Database["public"]["Enums"]["validation_severity"]
          updated_at: string
        }
        Insert: {
          action?: Database["public"]["Enums"]["validation_action"]
          active?: boolean
          allows_authorized_exception?: boolean
          assistance_group_id?: string | null
          company_ids?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          doctors?: Json
          hospital_id: string
          id?: string
          kind: Database["public"]["Enums"]["validation_kind"]
          name: string
          params?: Json
          payment_types?: string[]
          require_justification?: boolean
          scope_global?: boolean
          sectors?: string[]
          severity?: Database["public"]["Enums"]["validation_severity"]
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["validation_action"]
          active?: boolean
          allows_authorized_exception?: boolean
          assistance_group_id?: string | null
          company_ids?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          doctors?: Json
          hospital_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["validation_kind"]
          name?: string
          params?: Json
          payment_types?: string[]
          require_justification?: boolean
          scope_global?: boolean
          sectors?: string[]
          severity?: Database["public"]["Enums"]["validation_severity"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_rules_assistance_group_id_fkey"
            columns: ["assistance_group_id"]
            isOneToOne: false
            referencedRelation: "assistance_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_rules_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          created_at: string
          description: string | null
          event_key: string
          id: string
          is_active: boolean
          language_code: string
          provider_template_sid: string
          template_key: string
          updated_at: string
          variables: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_key: string
          id?: string
          is_active?: boolean
          language_code?: string
          provider_template_sid: string
          template_key: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          event_key?: string
          id?: string
          is_active?: boolean
          language_code?: string
          provider_template_sid?: string
          template_key?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      zeev_knowledge: {
        Row: {
          active: boolean | null
          body: string
          category: string
          created_at: string | null
          hospital_id: string | null
          id: string
          roles: string[] | null
          route_pattern: string | null
          search_vector: unknown
          sort_order: number | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          body: string
          category: string
          created_at?: string | null
          hospital_id?: string | null
          id?: string
          roles?: string[] | null
          route_pattern?: string | null
          search_vector?: unknown
          sort_order?: number | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          body?: string
          category?: string
          created_at?: string | null
          hospital_id?: string | null
          id?: string
          roles?: string[] | null
          route_pattern?: string | null
          search_vector?: unknown
          sort_order?: number | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zeev_knowledge_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      communication_threads_v: {
        Row: {
          answered_at: string | null
          assigned_to: string | null
          author_name: string | null
          channel: string | null
          first_response_at: string | null
          hospital_id: string | null
          last_author_type: string | null
          last_message_at: string | null
          opened_at: string | null
          payment_id: string | null
          preview: string | null
          read_at: string | null
          sla_alerted_at: string | null
          status: string | null
          subject_ref: string | null
          thread_id: string | null
        }
        Relationships: []
      }
      isolation_events: {
        Row: {
          action: string | null
          actor_id: string | null
          company_id: string | null
          company_name: string | null
          created_at: string | null
          diff: Json | null
          entity_id: string | null
          entity_type: string | null
          hospital_id: string | null
          id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string | null
          diff?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          hospital_id?: string | null
          id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string | null
          diff?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          hospital_id?: string | null
          id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_payments_flags: {
        Row: {
          has_divergence: boolean | null
          has_items_error: boolean | null
          has_open_question: boolean | null
          is_overdue: boolean | null
          payment_id: string | null
        }
        Insert: {
          has_divergence?: never
          has_items_error?: never
          has_open_question?: never
          is_overdue?: never
          payment_id?: string | null
        }
        Update: {
          has_divergence?: never
          has_items_error?: never
          has_open_question?: never
          is_overdue?: never
          payment_id?: string | null
        }
        Relationships: []
      }
      payment_types_unified: {
        Row: {
          active: boolean | null
          code: string | null
          color: string | null
          created_at: string | null
          description: string | null
          id: string | null
          label: string | null
          origin: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      portal_links_health: {
        Row: {
          accepted_at: string | null
          active: boolean | null
          created_at: string | null
          email: string | null
          id: string | null
          link_health: Database["public"]["Enums"]["portal_link_health"] | null
          portal_type: string | null
          target_id: string | null
          target_name: string | null
          user_id: string | null
        }
        Relationships: []
      }
      rules_pending_doctors_summary: {
        Row: {
          pending_companies: number | null
          pending_count: number | null
          rule_id: string | null
          rule_name: string | null
        }
        Relationships: []
      }
      v_glosa_debts_balance: {
        Row: {
          company_id: string | null
          created_at: string | null
          doctor_crm: string | null
          doctor_name: string | null
          id: string | null
          parcelas_default: number | null
          resolution_reason: string | null
          resolution_status: string | null
          status: string | null
          total_debt: number | null
          total_debt_stored: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_payment_items_registration_issues: {
        Row: {
          company_id: string | null
          company_name: string | null
          created_at: string | null
          doctor_document: string | null
          doctor_id: string | null
          doctor_name: string | null
          doctor_unregistered: boolean | null
          gross_amount: number | null
          item_id: string | null
          payment_id: string | null
          pj_not_linked_to_doctor: boolean | null
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          created_at?: string | null
          doctor_document?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          doctor_unregistered?: never
          gross_amount?: number | null
          item_id?: string | null
          payment_id?: string | null
          pj_not_linked_to_doctor?: never
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          created_at?: string | null
          doctor_document?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          doctor_unregistered?: never
          gross_amount?: number | null
          item_id?: string | null
          payment_id?: string | null
          pj_not_linked_to_doctor?: never
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      v_payment_production_period: {
        Row: {
          itens_sem_producao_real: number | null
          payment_id: string | null
          production_months: string[] | null
          production_period_end: string | null
          production_period_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      v_payments_flow_scope: {
        Row: {
          created_at: string | null
          is_historical: boolean | null
          passed_approval: boolean | null
          passed_validation: boolean | null
          payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          transitions_count: number | null
        }
        Relationships: []
      }
      v_piso_recorrencia: {
        Row: {
          competencia: string | null
          hospital_id: string | null
          items_com_piso: number | null
          items_piso_aplicado: number | null
          pct_piso_aplicado: number | null
          rule_id: string | null
          total_complementado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_applied_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_applied_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules_pending_doctors_summary"
            referencedColumns: ["rule_id"]
          },
          {
            foreignKeyName: "payment_items_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_group_rule_totals: {
        Row: {
          absorbido_total: number | null
          bruto_pedido_total: number | null
          bruto_regra_total: number | null
          company_id: string | null
          diferenca: number | null
          diferenca_pct: number | null
          group_id: string | null
          hospital_id: string | null
          itens_divergentes: number | null
          itens_sem_regra: number | null
          itens_total: number | null
          payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_company_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mv_payments_flags"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_company_groups_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_flow_scope"
            referencedColumns: ["payment_id"]
          },
        ]
      }
    }
    Functions: {
      _assert_can_cancel_group: {
        Args: { _group_id: string }
        Returns: undefined
      }
      _can_cancel_payment: { Args: { _uid: string }; Returns: boolean }
      _open_payment_ids_for_company: {
        Args: { _company_id: string }
        Returns: string[]
      }
      _open_payment_ids_for_pool: {
        Args: { _competence?: string; _pool_id: string }
        Returns: string[]
      }
      _resolve_payment_model_from_payment_type: {
        Args: { _pt_id: string }
        Returns: string
      }
      _resolve_payment_type_from_payment_model: {
        Args: { _pm_id: string }
        Returns: string
      }
      _validate_cancel_target: {
        Args: { _group_id: string }
        Returns: undefined
      }
      accept_payment_item: {
        Args: { _item_id: string; _justification: string }
        Returns: Json
      }
      accept_payment_item_keep_paid: {
        Args: { _item_id: string; _justification: string }
        Returns: Json
      }
      admin_clear_company_items:
        | {
            Args: { _company_name: string; _payment_id: string }
            Returns: number
          }
        | {
            Args: {
              _actor_id?: string
              _company_name: string
              _payment_id: string
            }
            Returns: number
          }
      admin_delete_payment: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      apply_calc_duplicity_resolution: {
        Args: {
          _chosen_calc_id: string
          _item_id: string
          _justification: string
        }
        Returns: Json
      }
      apply_duplicate_override: {
        Args: { _item_id: string; _justification: string }
        Returns: Json
      }
      apply_learned_hints_for_payment: {
        Args: { _payment_id: string }
        Returns: number
      }
      apply_rule_save_with_corrections: {
        Args: {
          _allow_calc_reduction?: boolean
          _calculations: Json
          _corrections: Json
          _rule_data: Json
        }
        Returns: Json
      }
      apply_special_case_to_items: {
        Args: { _mark_id: string }
        Returns: undefined
      }
      apply_zeev_bulk_manual:
        | {
            Args: {
              _item_ids: string[]
              _notes: string
              _override_reason?: string
              _reason_id: string
              _source?: string
            }
            Returns: {
              updated_count: number
            }[]
          }
        | {
            Args: {
              _custom_value?: number
              _item_ids: string[]
              _notes: string
              _override_reason?: string
              _reason_id: string
              _source?: string
              _value_strategy?: string
            }
            Returns: {
              updated_count: number
            }[]
          }
      approve_campaign: { Args: { _campaign_id: string }; Returns: undefined }
      approve_payment: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_group_ids: string[]
          p_note?: string
          p_payment_id: string
        }
        Returns: undefined
      }
      assert_hospital_access: {
        Args: { _hospital_id: string }
        Returns: undefined
      }
      audit_hospital_scope: {
        Args: never
        Returns: {
          args: string
          missing_scope_for: string
          proname: string
        }[]
      }
      backfill_batch_pattern_links: {
        Args: never
        Returns: {
          linked: number
          scanned: number
        }[]
      }
      backfill_payment_items_engine_columns: {
        Args: { _dry_run?: boolean }
        Returns: Json
      }
      build_rule_snapshot_payload: { Args: { _rule_id: string }; Returns: Json }
      bulk_conclude_analyst_groups: {
        Args: { _group_ids: string[]; _payment_id: string }
        Returns: {
          message: string
          skipped_count: number
          updated_count: number
        }[]
      }
      bulk_insert_new_payment_items: {
        Args: { _items: Json; _payment_id: string }
        Returns: number
      }
      bulk_insert_new_payment_unmatched_items: {
        Args: { _items: Json; _payment_id: string }
        Returns: number
      }
      bulk_send_groups_to_validation: {
        Args: { _group_ids: string[]; _payment_id: string }
        Returns: {
          message: string
          skipped_count: number
          updated_count: number
        }[]
      }
      calculate_payment_audit: { Args: { p_payment_id: string }; Returns: Json }
      calculate_payment_priority: {
        Args: { _payment_id: string }
        Returns: number
      }
      call_supervisor: {
        Args: {
          p_company_group_id: string
          p_note?: string
          p_payment_id: string
          p_stage: string
        }
        Returns: {
          notified_count: number
          question_id: string
        }[]
      }
      can_access_hospital: {
        Args: { _hid: string; _uid: string }
        Returns: boolean
      }
      can_access_pool_deduction_path: {
        Args: { _path: string }
        Returns: boolean
      }
      can_manage_new_payment: {
        Args: { _actor_id: string; _payment_id: string }
        Returns: boolean
      }
      cancel_by_reconciliation: {
        Args: {
          p_note?: string
          p_payment_id: string
          p_reason: Database["public"]["Enums"]["payment_cancellation_reason"]
          p_run_id: string
          p_scope: Json
        }
        Returns: Json
      }
      cancel_company_group_payment: {
        Args: {
          p_group_id: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["payment_cancellation_reason"]
        }
        Returns: Json
      }
      cancel_item_payment: {
        Args: {
          p_item_id: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["payment_cancellation_reason"]
        }
        Returns: Json
      }
      change_group_company: {
        Args: {
          p_new_company_id: string
          p_new_company_name: string
          p_reason?: string
          p_source_group_id: string
        }
        Returns: Json
      }
      claim_ai_retry_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          company_name: string
          created_at: string
          finished_at: string | null
          hospital_id: string
          id: string
          last_error: string | null
          last_job_id: string | null
          locked_at: string | null
          max_attempts: number
          next_attempt_at: string
          payment_id: string
          source_job_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_retry_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clone_reference_table_to_hospital: {
        Args: {
          _new_name?: string
          _reference_table_id: string
          _target_hospital_id: string
        }
        Returns: string
      }
      clone_rule_to_hospital: {
        Args: {
          _new_name?: string
          _rule_id: string
          _target_hospital_id: string
        }
        Returns: string
      }
      comm_reply_on_behalf: {
        Args: {
          p_channel: string
          p_message: string
          p_on_behalf_of: string
          p_thread_id: string
        }
        Returns: string
      }
      comm_thread_assign: {
        Args: { p_assignee: string; p_channel: string; p_thread_id: string }
        Returns: undefined
      }
      comm_thread_close: {
        Args: { p_channel: string; p_thread_id: string }
        Returns: undefined
      }
      comm_thread_mark_read: {
        Args: { p_channel: string; p_thread_id: string }
        Returns: undefined
      }
      companies_for_doctor_at: {
        Args: { _doctor_id: string; _hospital_id?: string; _on_date: string }
        Returns: {
          company_id: string
        }[]
      }
      compute_company_financial_aggregates: {
        Args: { p_company_id: string; p_payment_id: string }
        Returns: Json
      }
      compute_payment_item_hash: {
        Args: {
          _agreement: string
          _attendance: string
          _doctor_role: string
          _procedure_code: string
          _procedure_date: string
        }
        Returns: string
      }
      conclude_groups_at_validator: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_group_ids: string[]
          p_note?: string
          p_payment_id: string
        }
        Returns: undefined
      }
      conclude_historico_payment: {
        Args: { _payment_id: string }
        Returns: {
          message: string
          updated_count: number
        }[]
      }
      consume_validation_feedback: {
        Args: { _feedback_id: string }
        Returns: string
      }
      create_glosa_debt_with_items: {
        Args: {
          p_company_id: string
          p_doctor_crm: string
          p_doctor_name: string
          p_item_ids: string[]
          p_parcelas: number
        }
        Returns: string
      }
      current_active_hospital: { Args: never; Returns: string }
      dashboard_company_invoice_questions: {
        Args: { _created_by: string }
        Returns: {
          count: number
          first_payment_id: string
        }[]
      }
      dashboard_invoice_counts: {
        Args: { _created_by: string }
        Returns: {
          count: number
          status: Database["public"]["Enums"]["invoice_status"]
        }[]
      }
      dashboard_pending_company_groups: {
        Args: {
          _created_by: string
          _status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: {
          count: number
          payment_id: string
          reference: string
        }[]
      }
      declare_engine_source_applicable: {
        Args: { _applicable?: boolean; _payment_id: string; _source: string }
        Returns: undefined
      }
      delete_company_financial_adjustment: {
        Args: { _adjustment_id: string; _reason?: string }
        Returns: Json
      }
      delete_parecer_report: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      delete_payment_batch: { Args: { p_payment_id: string }; Returns: Json }
      distribute_unmatched_items_by_doctor: {
        Args: { _payment_id: string; _raw_company_name: string }
        Returns: {
          companies_used: string[]
          linked: number
          unresolved: number
        }[]
      }
      engine_sources_pending: {
        Args: { _payment_id: string }
        Returns: string[]
      }
      engine_sources_ready: { Args: { _payment_id: string }; Returns: boolean }
      enqueue_ai_retry: {
        Args: {
          p_company_name: string
          p_error: string
          p_hospital_id: string
          p_job_id?: string
          p_max_attempts?: number
          p_payment_id: string
        }
        Returns: string
      }
      enqueue_doctor_notification: {
        Args: {
          p_body: string
          p_doctor_id: string
          p_link_path?: string
          p_payment_id?: string
          p_payment_item_id?: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      enqueue_notification: {
        Args: {
          p_debounce_seconds?: number
          p_event: Json
          p_kind: string
          p_payment_id: string
          p_sender_id?: string
        }
        Returns: string
      }
      enrich_doctor_documents:
        | { Args: never; Returns: number }
        | { Args: { p_payment_id: string }; Returns: undefined }
      ensure_payment_company_financials_row: {
        Args: { p_company_id: string; p_payment_id: string }
        Returns: undefined
      }
      extract_rule_targets: {
        Args: {
          _group_company_links: Json
          _group_doctors: Json
          _scope: Database["public"]["Enums"]["rule_scope"]
          _target_company_id: string
          _target_identifier: string
          _target_type: Database["public"]["Enums"]["rule_target_type"]
        }
        Returns: {
          company_keys: string[]
          company_keys_all_doctors: string[]
          doctor_crms: string[]
        }[]
      }
      finalize_ai_retry: {
        Args: { p_error?: string; p_id: string; p_success: boolean }
        Returns: undefined
      }
      finalize_confeccao: { Args: { _payment_id: string }; Returns: undefined }
      find_doctor_by_document: {
        Args: { doc: string }
        Returns: {
          crm: string
          crm_uf: string
          full_name: string
          id: string
          specialties: string[]
        }[]
      }
      find_doctor_for_login: {
        Args: { identifier: string }
        Returns: {
          active: boolean
          cpf: string
          crm: string
          crm_uf: string
          doctor_id: string
          email: string
          full_name: string
          matched_by: string
        }[]
      }
      find_status_inconsistent_payments: {
        Args: { _limit?: number }
        Returns: {
          current_status: Database["public"]["Enums"]["payment_status"]
          expected_status: Database["public"]["Enums"]["payment_status"]
          last_updated: string
          payment_id: string
          total_groups: number
        }[]
      }
      fix_specialties_array: { Args: { arr: string[] }; Returns: string[] }
      forward_groups_to_director: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_group_ids: string[]
          p_note?: string
          p_payment_id: string
        }
        Returns: undefined
      }
      get_ai_accuracy: {
        Args: { p_days?: number }
        Returns: {
          accuracy_pct: number
          by_status: Json
          kept_count: number
          overridden_count: number
          total_analyzed: number
        }[]
      }
      get_batch_composition: {
        Args: { p_history_months?: number; p_processing_month?: string }
        Returns: {
          current_amount: number
          current_payment_id: string
          current_reference: string
          historical_avg: number
          historical_max: number
          historical_min: number
          months_present: number
          pattern_name: string
          status: string
        }[]
      }
      get_cancellation_report_detailed: {
        Args: { p_end?: string; p_hospital_id?: string; p_start?: string }
        Returns: Json
      }
      get_cancelled_payments_summary: {
        Args: { p_end?: string; p_hospital_id?: string; p_start?: string }
        Returns: Json
      }
      get_doctor_activity_log: {
        Args: { p_doctor_id: string; p_limit?: number }
        Returns: Json
      }
      get_doctor_concentration: {
        Args: { p_months_back?: number; p_track?: string }
        Returns: {
          amount: number
          doctor_name: string
          payment_id: string
          pct: number
          reference: string
          total_lote: number
        }[]
      }
      get_doctor_debt_summary: { Args: { p_doctor_id: string }; Returns: Json }
      get_doctor_glosas: {
        Args: {
          p_company_id?: string
          p_competencia?: string
          p_doctor_id: string
          p_status?: string
        }
        Returns: Json
      }
      get_doctor_linked_companies: {
        Args: { p_doctor_id: string }
        Returns: Json
      }
      get_doctor_notification_preferences: {
        Args: never
        Returns: {
          email_enabled: boolean
          notify_new_message: boolean
          notify_new_payment: boolean
          notify_status_change: boolean
        }[]
      }
      get_doctor_notification_unread_count: { Args: never; Returns: number }
      get_doctor_notifications: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          created_at: string
          id: string
          link_path: string
          payment_id: string
          payment_item_id: string
          read_at: string
          title: string
          type: string
        }[]
      }
      get_doctor_profile: { Args: { p_doctor_id: string }; Returns: Json }
      get_doctor_statement: {
        Args: { p_competence_month?: string; p_doctor_id: string }
        Returns: Json
      }
      get_doctors_missing_specialty: {
        Args: never
        Returns: {
          current_specialties: string[]
          doctor_name_norm: string
          doctor_name_raw: string
          matched_doctor_id: string
          matched_doctor_name: string
          n_items: number
          total_gross: number
        }[]
      }
      get_doctors_pii: {
        Args: { doctor_ids: string[] }
        Returns: {
          birth_date: string
          cpf: string
          email: string
          id: string
          phone: string
        }[]
      }
      get_dre_consolidated:
        | {
            Args: {
              p_company_id?: string
              p_competencia_from?: string
              p_competencia_to?: string
              p_doctor_id?: string
            }
            Returns: {
              bruto: number
              company_id: string
              company_name: string
              competencia: string
              creditos: number
              debitos: number
              doctor_id: string
              doctor_name: string
              glosas: number
              liquido: number
              payments_count: number
              pool: number
            }[]
          }
        | {
            Args: {
              p_company_id?: string
              p_competencia_from?: string
              p_competencia_to?: string
              p_doctor_id?: string
              p_track?: string
            }
            Returns: {
              bruto: number
              company_id: string
              company_name: string
              competencia: string
              creditos: number
              debitos: number
              doctor_id: string
              doctor_name: string
              glosas: number
              liquido: number
              payments_count: number
              pool: number
            }[]
          }
      get_dre_drilldown:
        | {
            Args: {
              p_company_id: string
              p_competencia: string
              p_doctor_id?: string
            }
            Returns: {
              bruto: number
              created_at: string
              creditos: number
              debitos: number
              glosas: number
              items_count: number
              liquido: number
              payment_id: string
              pool: number
              reference: string
              status: string
            }[]
          }
        | {
            Args: {
              p_company_id: string
              p_competencia: string
              p_doctor_id?: string
              p_track?: string
            }
            Returns: {
              bruto: number
              created_at: string
              creditos: number
              debitos: number
              glosas: number
              items_count: number
              liquido: number
              payment_id: string
              pool: number
              reference: string
              status: string
            }[]
          }
      get_exacta_principal_procedure_names: {
        Args: { p_hospital_id: string }
        Returns: {
          origem: string
          procedure_name: string
        }[]
      }
      get_group_block_thresholds: {
        Args: { _hospital_id: string }
        Returns: {
          block_abs: number
          block_pct: number
        }[]
      }
      get_intervention_preview: {
        Args: { p_hospital_id?: string }
        Returns: Json
      }
      get_intervention_savings: {
        Args: { p_end?: string; p_hospital_id?: string; p_start?: string }
        Returns: Json
      }
      get_invoice_upload_tokens: {
        Args: { p_invoice_ids: string[] }
        Returns: {
          invoice_id: string
          upload_token: string
        }[]
      }
      get_isolation_events: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          action: string | null
          actor_id: string | null
          company_id: string | null
          company_name: string | null
          created_at: string | null
          diff: Json | null
          entity_id: string | null
          entity_type: string | null
          hospital_id: string | null
          id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "isolation_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_journal_balance: {
        Args: {
          p_company_id?: string
          p_competencia_from?: string
          p_competencia_to?: string
          p_doctor_id?: string
        }
        Returns: number
      }
      get_lote_intervention_preview: {
        Args: { p_payment_id: string }
        Returns: {
          approved_at: string
          autor_id: string
          cancellation_reason: string
          company_id: string
          company_name: string
          delta: number
          doctor_name: string
          fonte: string
          id: string
          item_id: string
          payment_id: string
          procedure_code: string
          procedure_name: string
          valor_pago_final: number
          valor_regra: number
        }[]
      }
      get_missing_batch_patterns: {
        Args: never
        Returns: {
          avg_bruto: number
          competence_month: string
          days_late: number
          expected_by: string
          label: string
          last_seen_month: string
          pattern_id: string
        }[]
      }
      get_missing_batch_patterns_for: {
        Args: { _hospital: string }
        Returns: {
          avg_bruto: number
          competence_month: string
          days_late: number
          expected_by: string
          label: string
          last_seen_month: string
          pattern_id: string
        }[]
      }
      get_money_anomalies: {
        Args: { p_days?: number }
        Returns: {
          anomaly_type: string
          baseline_value: number
          details: Json
          detected_at: string
          entity_id: string
          entity_name: string
          metric_value: number
          severity: string
        }[]
      }
      get_money_funnel:
        | {
            Args: { p_end_date?: string; p_start_date?: string }
            Returns: {
              avg_age_days: number
              payment_count: number
              stage: string
              stage_order: number
              total_value: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_start_date?: string
              p_track?: string
            }
            Returns: {
              avg_age_days: number
              payment_count: number
              stage: string
              stage_order: number
              total_value: number
            }[]
          }
      get_open_position:
        | {
            Args: { p_company_id?: string }
            Returns: {
              age_days: number
              aging_bucket: string
              bruto: number
              company_id: string
              company_name: string
              competencia: string
              liquido: number
              payment_id: string
              reference: string
              status: string
            }[]
          }
        | {
            Args: { p_company_id?: string; p_track?: string }
            Returns: {
              age_days: number
              aging_bucket: string
              bruto: number
              company_id: string
              company_name: string
              competencia: string
              liquido: number
              payment_id: string
              reference: string
              status: string
            }[]
          }
      get_overlap_audit: {
        Args: {
          p_end: string
          p_excluded_specs?: string[]
          p_item_scope?: string
          p_min_distinct?: number
          p_specialty_mode?: string
          p_start: string
        }
        Returns: Json
      }
      get_pattern_anomalies: {
        Args: { p_min_months?: number; p_threshold_pct?: number }
        Returns: {
          avg_bruto: number
          competence_month: string
          current_bruto: number
          delta_pct: number
          months_seen: number
          pattern_id: string
          pattern_label: string
          payment_id: string
          payment_reference: string
          severity: string
          stddev_bruto: number
          z_score: number
        }[]
      }
      get_pattern_coverage: {
        Args: { p_months?: number }
        Returns: {
          coverage_pct: number
          linked_batches: number
          month_bucket: string
          total_batches: number
        }[]
      }
      get_pattern_stats: {
        Args: { p_pattern_id: string }
        Returns: {
          avg_bruto: number
          label: string
          last_seen_month: string
          max_bruto: number
          min_bruto: number
          months_seen: number
          pattern_id: string
          stddev_bruto: number
        }[]
      }
      get_pattern_volume_anomalies: {
        Args: {
          _lookback_months?: number
          _min_months?: number
          _threshold_pct?: number
        }
        Returns: {
          actual_count: number
          competence_month: string
          deviation_pct: number
          direction: string
          expected_avg: number
          months_seen: number
          pattern_id: string
          pattern_label: string
          payment_id: string
          payment_reference: string
          severity: string
          stddev_count: number
          z_score: number
        }[]
      }
      get_payment_pivot: {
        Args: {
          p_current_month: string
          p_grouping: string
          p_months_back: number
          p_payment_id?: string
          p_secondary?: string
          p_tertiary?: string
          p_track?: string
        }
        Returns: {
          group_key: string
          month_bucket: string
          parent_key: string
          total: number
        }[]
      }
      get_portal_company_breakdown: {
        Args: { p_doctor_id: string; p_months?: number }
        Returns: {
          company_id: string
          company_name: string
          quantidade: number
          valor_total: number
        }[]
      }
      get_portal_competencia_detail: {
        Args: { p_competencia: string; p_doctor_id: string }
        Returns: Json
      }
      get_portal_competencias: {
        Args: { p_doctor_id: string; p_limit?: number }
        Returns: {
          bruto: number
          competence_month: string
          esperado: number
          glosas: number
          itens_count: number
          itens_sem_regra: number
          liquido_estimado: number
          payment_ids: string[]
          status_agregado: string
        }[]
      }
      get_portal_dashboard_kpis: {
        Args: { p_doctor_id: string }
        Returns: Json
      }
      get_portal_doctor_debts: {
        Args: { p_doctor_id: string }
        Returns: {
          company_id: string
          created_at: string
          doctor_crm: string
          doctor_name: string
          id: string
          last_applied_at: string
          parcelas_default: number
          resolution_status: string
          saldo: number
          status: string
          total_aplicado: number
          total_debt: number
        }[]
      }
      get_portal_home: { Args: { p_doctor_id: string }; Returns: Json }
      get_portal_item_detail: { Args: { p_item_id: string }; Returns: Json }
      get_portal_payment_trend: {
        Args: { p_doctor_id: string; p_months?: number }
        Returns: {
          aprovado: number
          bruto: number
          competence_month: string
          glosa: number
          pago: number
        }[]
      }
      get_portal_thread_messages: {
        Args: { p_payment_id: string; p_payment_item_id?: string }
        Returns: {
          author_name: string
          author_type: string
          created_at: string
          id: string
          message: string
          read_by_doctor_at: string
        }[]
      }
      get_portal_threads: {
        Args: never
        Returns: {
          competence_month: string
          last_author_name: string
          last_author_type: string
          last_message: string
          last_message_at: string
          payment_id: string
          payment_item_id: string
          payment_reference: string
          procedure_code: string
          procedure_name: string
          thread_key: string
          total_count: number
          unread_count: number
        }[]
      }
      get_portal_top_procedures: {
        Args: { p_doctor_id: string; p_limit?: number; p_months?: number }
        Returns: {
          procedure_code: string
          procedure_name: string
          quantidade: number
          valor_total: number
        }[]
      }
      get_portal_unread_count: { Args: never; Returns: number }
      get_registration_pending_doctors: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          doctor_document: string
          doctor_id: string
          doctor_name: string
          items_count: number
          kind: string
          last_seen_at: string
          total_amount: number
        }[]
      }
      get_registration_pending_summary: {
        Args: never
        Returns: {
          affected_amount: number
          affected_items: number
          unlinked_pj_pairs: number
          unregistered_doctors: number
        }[]
      }
      get_return_rate: {
        Args: { p_days?: number }
        Returns: {
          return_count: number
          return_rate_pct: number
          return_status: string
          total_in_stage: number
        }[]
      }
      get_risk_details:
        | {
            Args: { p_limit?: number; p_tipo: string }
            Returns: {
              company_name: string
              competencia: string
              divergencia_pct: number
              doctor_name: string
              expected_amount: number
              gross_amount: number
              payment_id: string
              procedure_code: string
              reference: string
              specialty: string
              status: string
            }[]
          }
        | {
            Args: { p_limit?: number; p_only_active?: boolean; p_tipo: string }
            Returns: {
              company_name: string
              competencia: string
              divergencia_pct: number
              doctor_name: string
              expected_amount: number
              gross_amount: number
              payment_id: string
              procedure_code: string
              reference: string
              specialty: string
              status: string
            }[]
          }
      get_risk_summary:
        | {
            Args: { p_months_back?: number }
            Returns: {
              lotes_afetados: number
              qtd: number
              tipo: string
              valor_risco: number
            }[]
          }
        | {
            Args: { p_months_back?: number; p_only_active?: boolean }
            Returns: {
              lotes_afetados: number
              qtd: number
              tipo: string
              valor_risco: number
            }[]
          }
      get_rules_signature: { Args: { _hospital_id: string }; Returns: string }
      get_simulator_matched_names: {
        Args: {
          p_ano: number
          p_candidates: string[]
          p_hospital_id: string
          p_mode: string
        }
        Returns: string[]
      }
      get_spend_trend:
        | {
            Args: {
              p_current_month: string
              p_grouping: string
              p_months_back: number
            }
            Returns: {
              group_key: string
              month_bucket: string
              total: number
            }[]
          }
        | {
            Args: {
              p_current_month: string
              p_grouping: string
              p_months_back: number
              p_track?: string
            }
            Returns: {
              group_key: string
              month_bucket: string
              total: number
            }[]
          }
      get_stage_dwell_time: {
        Args: { p_days?: number }
        Returns: {
          avg_hours: number
          p50_hours: number
          p90_hours: number
          status: string
          transitions: number
        }[]
      }
      get_stuck_companies: {
        Args: { p_limit?: number }
        Returns: {
          company_id: string
          company_name: string
          max_age_days: number
          stuck_count: number
          total_stuck_value: number
          worst_status: string
        }[]
      }
      glosa_debt_consistency_check: {
        Args: never
        Returns: {
          debt_id: string
          diff: number
          doctor_crm: string
          doctor_name: string
          status: string
          total_debt_from_items: number
          total_debt_stored: number
        }[]
      }
      glosa_recompute_debt_for_doctor: {
        Args: { p_crm: string; p_name: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hospital_scope_allows: {
        Args: { _hospital_id: string }
        Returns: boolean
      }
      ignore_glosa_debt: {
        Args: { _debt_id: string; _reason: string }
        Returns: undefined
      }
      ignore_unmatched_items: {
        Args: {
          _payment_id: string
          _raw_company_name: string
          _reason?: string
        }
        Returns: number
      }
      increment_processing_progress: {
        Args: { _company_name: string; _error?: string; _job_id: string }
        Returns: {
          company_list: string[] | null
          created_at: string
          current_page: number
          failed_companies: Json
          finished_at: string | null
          hospital_id: string
          id: string
          payment_id: string
          processed_companies: number
          started_at: string
          status: string
          total_companies: number
          total_items: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_processing_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      init_engine_sources_for_payment: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      invalidate_engine_source: {
        Args: { _payment_id: string; _source: string }
        Returns: undefined
      }
      invalidate_rule_context: {
        Args: { _hospital_id: string }
        Returns: number
      }
      is_any_company_portal_user: { Args: { _uid: string }; Returns: boolean }
      is_any_doctor_portal_user: { Args: { _uid: string }; Returns: boolean }
      is_company_portal_user:
        | { Args: never; Returns: boolean }
        | { Args: { _company_id: string; _user_id: string }; Returns: boolean }
      is_feature_enabled: {
        Args: { _key: string; _user_id: string }
        Returns: boolean
      }
      is_global_role: { Args: { _uid: string }; Returns: boolean }
      is_payment_historico: { Args: { p_payment_id: string }; Returns: boolean }
      is_payment_in_analyst_phase: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      is_portal_user: { Args: { _uid: string }; Returns: boolean }
      is_service_role_call: { Args: never; Returns: boolean }
      is_valid_status_transition: {
        Args: {
          _from: Database["public"]["Enums"]["payment_status"]
          _to: Database["public"]["Enums"]["payment_status"]
        }
        Returns: boolean
      }
      learn_company_alias: {
        Args: { _company_id: string; _raw_name: string }
        Returns: undefined
      }
      link_glosa_to_company: {
        Args: { _company_id: string; _debt_id: string; _parcelas: number }
        Returns: string
      }
      link_unmatched_items_to_company: {
        Args: {
          _company_id: string
          _learn_alias?: boolean
          _payment_id: string
          _raw_company_name: string
        }
        Returns: number
      }
      list_decision_makers: {
        Args: { p_role: Database["public"]["Enums"]["app_role"] }
        Returns: {
          full_name: string
          id: string
        }[]
      }
      list_payments: {
        Args: {
          _filters?: Json
          _limit?: number
          _offset?: number
          _sort?: string
        }
        Returns: Json
      }
      log_hospital_switch: {
        Args: {
          p_new_hospital_id: string
          p_old_hospital_id?: string
          p_user_agent?: string
        }
        Returns: string
      }
      log_payment_recompute_failure: {
        Args: { _code: string; _error: string; _payment_id: string }
        Returns: undefined
      }
      lp_scope_hash: { Args: { _scope: Json }; Returns: string }
      map_calculation_type_to_method: {
        Args: { _ctype: string }
        Returns: string
      }
      mark_all_doctor_notifications_read: { Args: never; Returns: number }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_campaign_read: {
        Args: { _recipient_id: string }
        Returns: undefined
      }
      mark_doctor_notification_read: {
        Args: { p_id: string }
        Returns: boolean
      }
      mark_engine_source: {
        Args: {
          _applied_count?: number
          _details?: Json
          _job_id?: string
          _payment_id: string
          _source: string
          _total_value?: number
        }
        Returns: undefined
      }
      mark_notification_read: { Args: { _id: string }; Returns: undefined }
      mark_portal_thread_read: {
        Args: { p_payment_id: string; p_payment_item_id?: string }
        Returns: number
      }
      match_batch_pattern: {
        Args: { p_hospital_id: string; p_reference: string }
        Returns: string
      }
      materialize_intervention_ledger: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      merge_doctors_from_staging: { Args: never; Returns: Json }
      my_accessible_hospitals: {
        Args: never
        Returns: {
          active: boolean
          city: string
          id: string
          is_primary: boolean
          name: string
          uf: string
        }[]
      }
      next_rule_code: { Args: { _hospital_id: string }; Returns: string }
      norm_for_hash: { Args: { s: string }; Returns: string }
      norm_name: { Args: { t: string }; Returns: string }
      normalize_alias: { Args: { t: string }; Returns: string }
      normalize_sector: { Args: { input: string }; Returns: string }
      only_digits: { Args: { txt: string }; Returns: string }
      payments_global_stats: { Args: never; Returns: Json }
      payments_kpis: { Args: { _filters?: Json }; Returns: Json }
      portal_can_access_doctor: {
        Args: { p_doctor_id: string }
        Returns: boolean
      }
      portal_current_doctor_id: { Args: never; Returns: string }
      post_portal_message: {
        Args: {
          p_message: string
          p_payment_id: string
          p_payment_item_id?: string
        }
        Returns: string
      }
      purge_test_payments: { Args: never; Returns: number }
      question_company_group: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_company_group_id: string
          p_message: string
        }
        Returns: string
      }
      reactivate_cancelled_group: {
        Args: { p_group_id: string; p_note?: string }
        Returns: Json
      }
      reactivate_cancelled_item: {
        Args: { p_item_id: string; p_note?: string }
        Returns: Json
      }
      recalc_payment_priority: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      recompute_company_glosas_snapshot: {
        Args: { p_company_id: string; p_payment_id: string }
        Returns: undefined
      }
      recompute_doctor_specific_exclusions: { Args: never; Returns: undefined }
      recompute_payment_liquido: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      recompute_payment_status_from_groups: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      reconcile_job_progress: {
        Args: { _job_id: string }
        Returns: {
          company_list: string[] | null
          created_at: string
          current_page: number
          failed_companies: Json
          finished_at: string | null
          hospital_id: string
          id: string
          payment_id: string
          processed_companies: number
          started_at: string
          status: string
          total_companies: number
          total_items: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_processing_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_journal_entry: {
        Args: {
          p_company_id?: string
          p_competencia?: string
          p_context?: Json
          p_cost_center_id?: string
          p_created_by?: string
          p_doctor_id?: string
          p_operation_id: string
          p_payment_id?: string
          p_payment_item_id?: string
          p_reason?: string
          p_referencia?: string
          p_sinal: number
          p_tipo: string
          p_valor: number
        }
        Returns: string
      }
      record_status_anomaly: {
        Args: {
          _context?: Json
          _kind: string
          _payment_id: string
          _reason: string
          _severity?: string
          _status_from: Database["public"]["Enums"]["payment_status"]
          _status_to: Database["public"]["Enums"]["payment_status"]
        }
        Returns: string
      }
      register_external_approval:
        | {
            Args: {
              p_director_name: string
              p_evidence_path?: string
              p_group_ids: string[]
              p_note?: string
              p_payment_id: string
              p_registered_by: string
              p_source: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_decisor_id?: string
              p_director_name: string
              p_evidence_path?: string
              p_group_ids: string[]
              p_note?: string
              p_payment_id: string
              p_registered_by: string
              p_source: string
            }
            Returns: undefined
          }
      register_external_validation:
        | {
            Args: {
              p_evidence_path?: string
              p_group_ids: string[]
              p_note?: string
              p_payment_id: string
              p_registered_by: string
              p_source: string
              p_supervisor_name: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_decisor_id?: string
              p_evidence_path?: string
              p_group_ids: string[]
              p_note?: string
              p_payment_id: string
              p_registered_by: string
              p_source: string
              p_supervisor_name: string
            }
            Returns: undefined
          }
      reject_campaign: {
        Args: { _campaign_id: string; _reason: string }
        Returns: undefined
      }
      release_deduction_lock: {
        Args: { _company_id: string; _payment_id: string }
        Returns: undefined
      }
      repair_portal_links: { Args: never; Returns: Json }
      repair_status_inconsistencies: {
        Args: { _limit?: number }
        Returns: {
          after_status: Database["public"]["Enums"]["payment_status"]
          before_status: Database["public"]["Enums"]["payment_status"]
          expected_status: Database["public"]["Enums"]["payment_status"]
          fixed: boolean
          payment_id: string
          total_groups: number
        }[]
      }
      reply_question: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_company_group_id: string
          p_is_analista?: boolean
          p_message: string
        }
        Returns: undefined
      }
      resolve_convenio_slug: { Args: { _raw: string }; Returns: string }
      resolve_glosa_to_company: {
        Args: { _debt_id: string }
        Returns: undefined
      }
      resolve_system_parameter: {
        Args: {
          p_convenio_slug?: string
          p_hospital_id?: string
          p_key: string
          p_specialty?: string
        }
        Returns: Json
      }
      restore_rule_from_snapshot: {
        Args: { _snapshot_id: string }
        Returns: Json
      }
      retry_payment_recompute_failures: {
        Args: { _limit?: number }
        Returns: {
          error_message: string
          payment_id: string
          succeeded: boolean
        }[]
      }
      return_groups_to_analyst:
        | {
            Args: {
              p_author_id: string
              p_author_name: string
              p_group_ids: string[]
              p_message: string
              p_payment_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_author_id: string
              p_author_name: string
              p_group_ids: string[]
              p_lot_level?: boolean
              p_message: string
              p_payment_id: string
            }
            Returns: undefined
          }
      reverse_journal_entry: {
        Args: { p_created_by?: string; p_entry_id: string; p_reason: string }
        Returns: string
      }
      revert_cost_center_import: { Args: { _import_id: string }; Returns: Json }
      revert_glosa_debt: {
        Args: { p_debt_id: string; p_reason: string }
        Returns: Json
      }
      rls_test_cleanup: {
        Args: {
          _hosp_a: string
          _hosp_b: string
          _user_a: string
          _user_b: string
        }
        Returns: undefined
      }
      rls_test_hospital_tables: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      rls_test_setup: {
        Args: { _user_a: string; _user_b: string }
        Returns: Json
      }
      rollback_new_payment: { Args: { _payment_id: string }; Returns: Json }
      rule_pending_doctors: {
        Args: { p_rule_id: string }
        Returns: {
          company_id: string
          company_name: string
          doctor_crm: string
          doctor_crm_uf: string
          doctor_id: string
          doctor_name: string
          linked_since: string
          rule_id: string
        }[]
      }
      scan_all_doctor_notes: {
        Args: never
        Returns: {
          matched: number
          scanned: number
          suggestions_created: number
        }[]
      }
      set_active_hospital: {
        Args: { p_hospital_id: string }
        Returns: undefined
      }
      set_primary_hospital_for_user: {
        Args: {
          _hospital_id: string
          _role?: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      silence_learned_pattern: {
        Args: { _new_status?: string; _pattern_id: string; _reason: string }
        Returns: undefined
      }
      state_scope_allows: { Args: { _state_uf: string }; Returns: boolean }
      storage_object_hospital_allows: {
        Args: { _bucket: string; _name: string }
        Returns: boolean
      }
      suggest_batch_patterns: {
        Args: { p_history_months?: number }
        Returns: {
          avg_bruto: number
          distinct_references: string[]
          months_seen: number
          payment_ids: string[]
          suggested_label: string
        }[]
      }
      sync_payment_company_group: {
        Args: { p_company_id: string; p_payment_id: string }
        Returns: undefined
      }
      test_group_reconciliation_gate: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      try_acquire_deduction_lock: {
        Args: {
          _company_id: string
          _hospital_id?: string
          _payment_id: string
        }
        Returns: boolean
      }
      undo_accept_payment_item: { Args: { _item_id: string }; Returns: Json }
      unignore_glosa_debt: { Args: { _debt_id: string }; Returns: undefined }
      unlearn_company_alias: {
        Args: { _company_id: string; _raw_name: string }
        Returns: undefined
      }
      update_doctor_notification_preferences: {
        Args: {
          p_email_enabled: boolean
          p_notify_new_message: boolean
          p_notify_new_payment: boolean
          p_notify_status_change: boolean
        }
        Returns: undefined
      }
      update_doctor_profile: {
        Args: { p_email_secundario?: string; p_phone?: string }
        Returns: undefined
      }
      upsert_payment_company_financials_snapshot: {
        Args: {
          p_bruto: number
          p_company_id: string
          p_computed_at?: string
          p_computed_by?: string
          p_conciliacao: number
          p_conciliacao_aplicada: boolean
          p_creditos: number
          p_debitos: number
          p_glosas: number
          p_liquido: number
          p_payment_id: string
          p_pool: number
          p_pool_aplicado: boolean
          p_pool_detalhes: Json
          p_pool_preview: boolean
        }
        Returns: Json
      }
      user_belongs_to_company: {
        Args: { _company_id: string }
        Returns: boolean
      }
      user_can_see_hospital: {
        Args: { _hospital_id: string }
        Returns: boolean
      }
      user_hospital_ids: { Args: { _user_id: string }; Returns: string[] }
      user_is_empresa_recipient_of: {
        Args: { _campaign_id: string }
        Returns: boolean
      }
      user_is_medico_recipient_of: {
        Args: { _campaign_id: string }
        Returns: boolean
      }
      user_state_ufs: { Args: { _uid: string }; Returns: string[] }
      validate_rule_save: {
        Args: {
          _group_company_links: Json
          _group_doctors: Json
          _hospital_id?: string
          _rule_id: string
          _scope: Database["public"]["Enums"]["rule_scope"]
          _target_company_id: string
          _target_identifier: string
          _target_type: Database["public"]["Enums"]["rule_target_type"]
          _valid_from: string
          _valid_until: string
        }
        Returns: Json
      }
      zeev_search_knowledge: {
        Args: {
          p_limit?: number
          p_query: string
          p_role?: string
          p_route?: string
        }
        Returns: {
          body: string
          category: string
          id: string
          rank: number
          route_pattern: string
          tags: string[]
          title: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "diretor"
        | "validador"
        | "analista"
        | "empresa"
        | "medico"
        | "gestao_medica"
      confeccao_status: "em_confeccao" | "confeccao_concluida" | "cancelada"
      email_approval_status:
        | "pending_parse"
        | "parsing"
        | "validated"
        | "divergent"
        | "parse_failed"
        | "applied"
        | "rejected"
      invoice_status:
        | "aguardando"
        | "recebida"
        | "conciliada"
        | "divergente"
        | "cancelada"
      item_ai_status:
        | "pendente"
        | "aprovado"
        | "alerta"
        | "reprovado"
        | "erro_duplicidade_pagamento"
        | "erro_duplicidade_calculo"
        | "acatado"
      magic_link_action:
        | "approve"
        | "reject"
        | "return_to_analyst"
        | "return_to_validator"
        | "view"
        | "approve_reapproval"
        | "reject_reapproval"
      notification_channel: "email" | "whatsapp" | "both" | "off"
      notification_delivery_status:
        | "queued"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "bounced"
      observation_author:
        | "ia"
        | "analista"
        | "validador"
        | "diretor"
        | "sistema"
      observation_type:
        | "informativo"
        | "impacta_aprovacao"
        | "justificativa_override"
      payment_analysis_mode:
        | "padrao"
        | "empresa_prioritaria"
        | "isolado"
        | "confeccao"
        | "manual"
      payment_cancellation_reason:
        | "medico_fatura_externamente"
        | "contrato_encerrado"
        | "glosa_total_quitada"
        | "decisao_juridica"
        | "duplicidade_externa"
        | "outro"
        | "economia_real"
        | "pago_em_outro_lote"
        | "duplicidade_motor"
      payment_kind: "atual" | "pendencia" | "misto"
      payment_status:
        | "rascunho"
        | "em_confeccao"
        | "em_analise_ia"
        | "revisao_analista"
        | "concluida_analista"
        | "aguardando_validacao"
        | "devolvido_analista"
        | "aguardando_aprovacao"
        | "aprovado_em_revisao"
        | "aprovado"
        | "aprovado_com_ressalva"
        | "pedido_nf_enviado"
        | "nf_recebida"
        | "nf_questionada"
        | "nf_divergente"
        | "nf_conciliada"
        | "lancado"
        | "arquivado"
        | "pago"
        | "rejeitado"
        | "cancelado"
        | "em_questionamento"
        | "aprovado_parcial"
        | "revisao_pos_aprovacao"
        | "concluido_validacao"
      payment_track: "prioritario" | "habitual"
      portal_link_health: "ok" | "orphan_user" | "orphan_target" | "inactive"
      reapproval_trigger_source:
        | "analyst_edit"
        | "invoice_pendency"
        | "company_change_source"
        | "company_change_destination"
      reference_table_kind:
        | "simples"
        | "cbhpm"
        | "tabela_propria"
        | "lista_codigos"
        | "pacote_combinacao"
      retro_exclusion_reason:
        | "mudanca_data_administrativa"
        | "cancelamento_externo"
        | "duplicidade_ja_resolvida"
        | "acordo_diferenciado"
        | "outro"
      retro_recon_classification:
        | "ok_pago"
        | "pago_a_menos"
        | "nao_pago"
        | "pago_outro_mes"
        | "sem_lastro"
        | "pendente"
        | "tuss_divergente"
        | "ausente_tasy"
        | "pago_a_mais"
        | "div_valor"
        | "div_qtd_valor"
      retro_recon_status: "em_analise" | "concluida" | "cancelada"
      rule_calculation_type:
        | "percentual_sobre_convenio"
        | "regra_vias"
        | "pacote_fechado"
        | "pacote_com_extras"
        | "valor_fixo"
        | "exclusao"
        | "informativo"
        | "pacote_por_atendimento"
        | "tabela_diferenciada"
        | "bonus"
        | "complemento"
        | "pacote"
      rule_payment_term: "qualquer" | "prioridade" | "habitual"
      rule_scope: "master" | "especifica" | "grupo"
      rule_sector:
        | "cirurgia"
        | "hemodinamica"
        | "parecer"
        | "visita"
        | "procedimento"
        | "consulta"
        | "outro"
        | "sadt_endoscopia"
      rule_severity: "info" | "aviso" | "bloqueio"
      rule_suggestion_status: "pending" | "approved" | "rejected" | "converted"
      rule_target_type: "medico" | "empresa"
      special_case_origin: "medico_portal" | "analista" | "gestao_medica"
      special_case_status: "pending" | "approved" | "rejected" | "revoked"
      threshold_type: "percentual" | "absoluto"
      user_company_marker: "pinned" | "waiting" | "reviewed"
      validation_action: "informar" | "alerta" | "alerta_forte" | "bloquear"
      validation_kind:
        | "duplicidade_exata"
        | "duplicidade_atendimento"
        | "sobreposicao_assistencial"
        | "codigo_sem_dobra"
        | "codigo_nao_remuneravel"
        | "item_em_pacote"
        | "particular_sem_excecao"
        | "outlier_valor"
        | "parecer_virou_cirurgia"
        | "restricao_contratual"
        | "duplicidade_lancamento"
      validation_severity:
        | "informativo"
        | "alerta"
        | "alerta_forte"
        | "bloquear"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "diretor",
        "validador",
        "analista",
        "empresa",
        "medico",
        "gestao_medica",
      ],
      confeccao_status: ["em_confeccao", "confeccao_concluida", "cancelada"],
      email_approval_status: [
        "pending_parse",
        "parsing",
        "validated",
        "divergent",
        "parse_failed",
        "applied",
        "rejected",
      ],
      invoice_status: [
        "aguardando",
        "recebida",
        "conciliada",
        "divergente",
        "cancelada",
      ],
      item_ai_status: [
        "pendente",
        "aprovado",
        "alerta",
        "reprovado",
        "erro_duplicidade_pagamento",
        "erro_duplicidade_calculo",
        "acatado",
      ],
      magic_link_action: [
        "approve",
        "reject",
        "return_to_analyst",
        "return_to_validator",
        "view",
        "approve_reapproval",
        "reject_reapproval",
      ],
      notification_channel: ["email", "whatsapp", "both", "off"],
      notification_delivery_status: [
        "queued",
        "sent",
        "delivered",
        "read",
        "failed",
        "bounced",
      ],
      observation_author: ["ia", "analista", "validador", "diretor", "sistema"],
      observation_type: [
        "informativo",
        "impacta_aprovacao",
        "justificativa_override",
      ],
      payment_analysis_mode: [
        "padrao",
        "empresa_prioritaria",
        "isolado",
        "confeccao",
        "manual",
      ],
      payment_cancellation_reason: [
        "medico_fatura_externamente",
        "contrato_encerrado",
        "glosa_total_quitada",
        "decisao_juridica",
        "duplicidade_externa",
        "outro",
        "economia_real",
        "pago_em_outro_lote",
        "duplicidade_motor",
      ],
      payment_kind: ["atual", "pendencia", "misto"],
      payment_status: [
        "rascunho",
        "em_confeccao",
        "em_analise_ia",
        "revisao_analista",
        "concluida_analista",
        "aguardando_validacao",
        "devolvido_analista",
        "aguardando_aprovacao",
        "aprovado_em_revisao",
        "aprovado",
        "aprovado_com_ressalva",
        "pedido_nf_enviado",
        "nf_recebida",
        "nf_questionada",
        "nf_divergente",
        "nf_conciliada",
        "lancado",
        "arquivado",
        "pago",
        "rejeitado",
        "cancelado",
        "em_questionamento",
        "aprovado_parcial",
        "revisao_pos_aprovacao",
        "concluido_validacao",
      ],
      payment_track: ["prioritario", "habitual"],
      portal_link_health: ["ok", "orphan_user", "orphan_target", "inactive"],
      reapproval_trigger_source: [
        "analyst_edit",
        "invoice_pendency",
        "company_change_source",
        "company_change_destination",
      ],
      reference_table_kind: [
        "simples",
        "cbhpm",
        "tabela_propria",
        "lista_codigos",
        "pacote_combinacao",
      ],
      retro_exclusion_reason: [
        "mudanca_data_administrativa",
        "cancelamento_externo",
        "duplicidade_ja_resolvida",
        "acordo_diferenciado",
        "outro",
      ],
      retro_recon_classification: [
        "ok_pago",
        "pago_a_menos",
        "nao_pago",
        "pago_outro_mes",
        "sem_lastro",
        "pendente",
        "tuss_divergente",
        "ausente_tasy",
        "pago_a_mais",
        "div_valor",
        "div_qtd_valor",
      ],
      retro_recon_status: ["em_analise", "concluida", "cancelada"],
      rule_calculation_type: [
        "percentual_sobre_convenio",
        "regra_vias",
        "pacote_fechado",
        "pacote_com_extras",
        "valor_fixo",
        "exclusao",
        "informativo",
        "pacote_por_atendimento",
        "tabela_diferenciada",
        "bonus",
        "complemento",
        "pacote",
      ],
      rule_payment_term: ["qualquer", "prioridade", "habitual"],
      rule_scope: ["master", "especifica", "grupo"],
      rule_sector: [
        "cirurgia",
        "hemodinamica",
        "parecer",
        "visita",
        "procedimento",
        "consulta",
        "outro",
        "sadt_endoscopia",
      ],
      rule_severity: ["info", "aviso", "bloqueio"],
      rule_suggestion_status: ["pending", "approved", "rejected", "converted"],
      rule_target_type: ["medico", "empresa"],
      special_case_origin: ["medico_portal", "analista", "gestao_medica"],
      special_case_status: ["pending", "approved", "rejected", "revoked"],
      threshold_type: ["percentual", "absoluto"],
      user_company_marker: ["pinned", "waiting", "reviewed"],
      validation_action: ["informar", "alerta", "alerta_forte", "bloquear"],
      validation_kind: [
        "duplicidade_exata",
        "duplicidade_atendimento",
        "sobreposicao_assistencial",
        "codigo_sem_dobra",
        "codigo_nao_remuneravel",
        "item_em_pacote",
        "particular_sem_excecao",
        "outlier_valor",
        "parecer_virou_cirurgia",
        "restricao_contratual",
        "duplicidade_lancamento",
      ],
      validation_severity: [
        "informativo",
        "alerta",
        "alerta_forte",
        "bloquear",
      ],
    },
  },
} as const
