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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      analysis_dead_letter: {
        Row: {
          attempts: number
          company_name: string
          created_at: string
          errors: Json
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          ai_ms: number
          cache_hit: boolean
          company_name: string | null
          created_at: string
          error: string | null
          hospital_id: string | null
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
          ai_ms?: number
          cache_hit?: boolean
          company_name?: string | null
          created_at?: string
          error?: string | null
          hospital_id?: string | null
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
          ai_ms?: number
          cache_hit?: boolean
          company_name?: string | null
          created_at?: string
          error?: string | null
          hospital_id?: string | null
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
          audience: Json
          channels: string[]
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          hospital_id: string | null
          id: string
          message: string
          scheduled_for: string | null
          status: string
          title: string
          totals: Json
          updated_at: string
        }
        Insert: {
          allow_reply?: boolean
          audience?: Json
          channels?: string[]
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          hospital_id?: string | null
          id?: string
          message: string
          scheduled_for?: string | null
          status?: string
          title: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          allow_reply?: boolean
          audience?: Json
          channels?: string[]
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          hospital_id?: string | null
          id?: string
          message?: string
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
          document?: string | null
          id?: string
          invoice_emails?: string[]
          name?: string
          notes?: string | null
          state_uf?: string | null
          tem_pool?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      company_access_log: {
        Row: {
          company_id: string
          created_at: string
          id: string
          resource: string
          resource_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          resource: string
          resource_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          created_at: string
          created_by: string | null
          data_inicio: string
          descricao: string
          hospital_id: string | null
          id: string
          origem: string | null
          parcelas_pagas: number
          parcelas_total: number
          tipo: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          ativo?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          data_inicio?: string
          descricao: string
          hospital_id?: string | null
          id?: string
          origem?: string | null
          parcelas_pagas?: number
          parcelas_total?: number
          tipo: string
          updated_at?: string
          valor_total: number
        }
        Update: {
          ativo?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          data_inicio?: string
          descricao?: string
          hospital_id?: string | null
          id?: string
          origem?: string | null
          parcelas_pagas?: number
          parcelas_total?: number
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
            foreignKeyName: "company_financial_adjustments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
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
      company_messages: {
        Row: {
          author_name: string
          author_type: string
          author_user_id: string | null
          company_id: string
          created_at: string
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          company_id: string
          created_at: string
          created_by_type: string
          created_by_user_id: string | null
          hospital_id: string | null
          id: string
          invoice_id: string | null
          last_message_at: string
          last_message_preview: string | null
          payment_id: string | null
          scope: string
          status: string
          subject: string
          unread_for_company: number
          unread_for_internal: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by_type: string
          created_by_user_id?: string | null
          hospital_id?: string | null
          id?: string
          invoice_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          payment_id?: string | null
          scope: string
          status?: string
          subject: string
          unread_for_company?: number
          unread_for_internal?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by_type?: string
          created_by_user_id?: string | null
          hospital_id?: string | null
          id?: string
          invoice_id?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          payment_id?: string | null
          scope?: string
          status?: string
          subject?: string
          unread_for_company?: number
          unread_for_internal?: number
        }
        Relationships: [
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
        ]
      }
      conciliation_bases: {
        Row: {
          base_anterior_id: string | null
          col_map: Json | null
          competence_month: string | null
          created_at: string | null
          file_name: string | null
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      convenios: {
        Row: {
          active: boolean
          aliases: string[]
          code: string
          created_at: string
          deactivated_at: string | null
          name: string
          notes: string | null
          operator_code: string | null
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
          deactivated_at?: string | null
          name: string
          notes?: string | null
          operator_code?: string | null
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
          deactivated_at?: string | null
          name?: string
          notes?: string | null
          operator_code?: string | null
          slug?: string
          sort_order?: number
          state_uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_center_imports: {
        Row: {
          created_count: number
          deactivated_count: number
          file_name: string | null
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
      doctor_messages: {
        Row: {
          assigned_to: string | null
          author_name: string
          author_type: string
          author_user_id: string | null
          created_at: string
          doctor_id: string
          first_response_at: string | null
          hospital_id: string | null
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
          created_at?: string
          doctor_id: string
          first_response_at?: string | null
          hospital_id?: string | null
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
          created_at?: string
          doctor_id?: string
          first_response_at?: string | null
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          crm: string
          crm_uf: string
          email: string | null
          full_name: string
          id: number
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
          crm: string
          crm_uf: string
          email?: string | null
          full_name: string
          id?: number
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
          crm?: string
          crm_uf?: string
          email?: string | null
          full_name?: string
          id?: number
          notes_cnpj?: string | null
          notes_pj?: string | null
          phone?: string | null
          specialties?: string | null
          vinculo?: string | null
        }
        Relationships: []
      }
      doctors_specialties_backup_20260518: {
        Row: {
          active: boolean | null
          backed_up_at: string | null
          crm: string | null
          full_name: string | null
          id: string | null
          specialties: string[] | null
        }
        Insert: {
          active?: boolean | null
          backed_up_at?: string | null
          crm?: string | null
          full_name?: string | null
          id?: string | null
          specialties?: string[] | null
        }
        Update: {
          active?: boolean | null
          backed_up_at?: string | null
          crm?: string | null
          full_name?: string | null
          id?: string | null
          specialties?: string[] | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
          id: string
          matched_items: number | null
          reference: string
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
          hospital_id?: string | null
          id?: string
          matched_items?: number | null
          reference: string
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
          hospital_id?: string | null
          id?: string
          matched_items?: number | null
          reference?: string
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
          hospital_id: string | null
          id: string
        }
        Insert: {
          amount: number
          applied_amount?: number | null
          created_at?: string | null
          debt_id: string
          glosa_item_id: string
          hospital_id?: string | null
          id?: string
        }
        Update: {
          amount?: number
          applied_amount?: number | null
          created_at?: string | null
          debt_id?: string
          glosa_item_id?: string
          hospital_id?: string | null
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
          created_at: string | null
          doctor_crm: string | null
          doctor_name: string
          hospital_id: string | null
          id: string
          ignored_at: string | null
          ignored_by: string | null
          ignored_reason: string | null
          last_applied_at: string | null
          last_payment_id: string | null
          parcelas_default: number
          resolution_reason: string | null
          resolution_status: string
          status: string
          total_debt: number
          updated_at: string | null
        }
        Insert: {
          adjustment_id?: string | null
          company_id?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_name: string
          hospital_id?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          ignored_reason?: string | null
          last_applied_at?: string | null
          last_payment_id?: string | null
          parcelas_default?: number
          resolution_reason?: string | null
          resolution_status?: string
          status?: string
          total_debt?: number
          updated_at?: string | null
        }
        Update: {
          adjustment_id?: string | null
          company_id?: string | null
          created_at?: string | null
          doctor_crm?: string | null
          doctor_name?: string
          hospital_id?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          ignored_reason?: string | null
          last_applied_at?: string | null
          last_payment_id?: string | null
          parcelas_default?: number
          resolution_reason?: string | null
          resolution_status?: string
          status?: string
          total_debt?: number
          updated_at?: string | null
        }
        Relationships: [
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
          hospital_id: string | null
          id: string
          matched_at: string | null
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
          hospital_id?: string | null
          id?: string
          matched_at?: string | null
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
          hospital_id?: string | null
          id?: string
          matched_at?: string | null
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
          hospital_id: string | null
          id: string
          parcela_numero: number
          payment_id: string
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
          hospital_id?: string | null
          id?: string
          parcela_numero: number
          payment_id: string
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
          hospital_id?: string | null
          id?: string
          parcela_numero?: number
          payment_id?: string
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
          created_at?: string
          id?: string
          name?: string
          slug?: string
          state_uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_question_attachments: {
        Row: {
          author_id: string | null
          author_type: string
          created_at: string
          file_name: string
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      payment_assignments: {
        Row: {
          action: string
          analyst_id: string
          created_at: string
          created_by: string
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      payment_company_groups: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bruto_total: number
          company_id: string | null
          company_name: string
          created_at: string
          hospital_id: string | null
          id: string
          items_count: number
          liquido_total: number
          payment_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          company_id?: string | null
          company_name: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          items_count?: number
          liquido_total?: number
          payment_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          company_id?: string | null
          company_name?: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          items_count?: number
          liquido_total?: number
          payment_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
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
        ]
      }
      payment_director_notifications: {
        Row: {
          email_results: Json
          hospital_id: string | null
          id: string
          notified_at: string
          payment_id: string
          whatsapp_results: Json
        }
        Insert: {
          email_results?: Json
          hospital_id?: string | null
          id?: string
          notified_at?: string
          payment_id: string
          whatsapp_results?: Json
        }
        Update: {
          email_results?: Json
          hospital_id?: string | null
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
        ]
      }
      payment_items: {
        Row: {
          acatado_at: string | null
          acatado_by: string | null
          acatado_status_original: string | null
          access_route: string | null
          agreement_text: string | null
          ai_findings: Json | null
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
          company_id: string | null
          company_name: string | null
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
          gross_amount: number
          hospital_id: string | null
          id: string
          item_hash: string | null
          item_origem: string | null
          manual_note: string | null
          origem_reconciliation_item_id: string | null
          origem_referencia: string | null
          patient_name: string | null
          payment_id: string
          procedure_amount: number | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_name: string | null
          quantity: number | null
          rateio: Json | null
          raw_data: Json | null
          sector: string | null
          sector_matched_by: string | null
          sector_original: string | null
          sector_slug: string | null
          source: string
          specialty: string | null
          tipo_item: string | null
          tipo_linha: string | null
          validation_findings: Json
        }
        Insert: {
          acatado_at?: string | null
          acatado_by?: string | null
          acatado_status_original?: string | null
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
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
          company_id?: string | null
          company_name?: string | null
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
          gross_amount?: number
          hospital_id?: string | null
          id?: string
          item_hash?: string | null
          item_origem?: string | null
          manual_note?: string | null
          origem_reconciliation_item_id?: string | null
          origem_referencia?: string | null
          patient_name?: string | null
          payment_id: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          rateio?: Json | null
          raw_data?: Json | null
          sector?: string | null
          sector_matched_by?: string | null
          sector_original?: string | null
          sector_slug?: string | null
          source?: string
          specialty?: string | null
          tipo_item?: string | null
          tipo_linha?: string | null
          validation_findings?: Json
        }
        Update: {
          acatado_at?: string | null
          acatado_by?: string | null
          acatado_status_original?: string | null
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
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
          company_id?: string | null
          company_name?: string | null
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
          gross_amount?: number
          hospital_id?: string | null
          id?: string
          item_hash?: string | null
          item_origem?: string | null
          manual_note?: string | null
          origem_reconciliation_item_id?: string | null
          origem_referencia?: string | null
          patient_name?: string | null
          payment_id?: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          rateio?: Json | null
          raw_data?: Json | null
          sector?: string | null
          sector_matched_by?: string | null
          sector_original?: string | null
          sector_slug?: string | null
          source?: string
          specialty?: string | null
          tipo_item?: string | null
          tipo_linha?: string | null
          validation_findings?: Json
        }
        Relationships: [
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
            foreignKeyName: "payment_items_origem_reconciliation_item_id_fkey"
            columns: ["origem_reconciliation_item_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_items"
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
          hospital_id: string | null
          is_snapshot: boolean
          job_id: string
          meta: Json
          payment_id: string
          size_bytes: number | null
        }
        Insert: {
          built_at?: string
          context: Json
          hospital_id?: string | null
          is_snapshot?: boolean
          job_id: string
          meta?: Json
          payment_id: string
          size_bytes?: number | null
        }
        Update: {
          built_at?: string
          context?: Json
          hospital_id?: string | null
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
      payment_observations: {
        Row: {
          answered_by_observation_id: string | null
          author_id: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at: string
          edited_at: string | null
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      payment_pivot_cache: {
        Row: {
          cache_key: string
          created_at: string
          hospital_id: string | null
          id: string
          payment_id: string
          rows: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          hospital_id?: string | null
          id?: string
          payment_id: string
          rows: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          hospital_id?: string | null
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
        ]
      }
      payment_processing_jobs: {
        Row: {
          company_list: string[] | null
          created_at: string
          current_page: number
          failed_companies: Json
          finished_at: string | null
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
      payment_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          hospital_id: string | null
          id: string
          payment_id: string
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          hospital_id?: string | null
          id?: string
          payment_id: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          hospital_id?: string | null
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
        ]
      }
      payment_types: {
        Row: {
          active: boolean
          code: string
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label?: string
          sort_order?: number
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
          hospital_id: string | null
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
          procedure_name: string | null
          quantity: number | null
          raw_company_name: string
          raw_data: Json
          resolved_at: string | null
          resolved_by: string | null
          resolved_company_id: string | null
          sector: string | null
          source_file: string | null
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
          hospital_id?: string | null
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
          procedure_name?: string | null
          quantity?: number | null
          raw_company_name: string
          raw_data?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_company_id?: string | null
          sector?: string | null
          source_file?: string | null
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
          hospital_id?: string | null
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
          procedure_name?: string | null
          quantity?: number | null
          raw_company_name?: string
          raw_data?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_company_id?: string | null
          sector?: string | null
          source_file?: string | null
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
          approval_pdf_path: string | null
          approved_at: string | null
          approved_by: string | null
          bruto_total: number
          competence_month: string | null
          competence_months: string[]
          cost_center_code: string | null
          created_at: string
          created_by: string
          description: string | null
          hospital_id: string | null
          id: string
          items_count: number
          liquido_total: number
          payment_due_date: string | null
          payment_kind: Database["public"]["Enums"]["payment_kind"] | null
          payment_type: string | null
          priority_score: number
          processing_diagnostics: Json | null
          processing_timeout_occurred: boolean | null
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
          approval_pdf_path?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          competence_month?: string | null
          competence_months?: string[]
          cost_center_code?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          hospital_id?: string | null
          id?: string
          items_count?: number
          liquido_total?: number
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_type?: string | null
          priority_score?: number
          processing_diagnostics?: Json | null
          processing_timeout_occurred?: boolean | null
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
          approval_pdf_path?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bruto_total?: number
          competence_month?: string | null
          competence_months?: string[]
          cost_center_code?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          hospital_id?: string | null
          id?: string
          items_count?: number
          liquido_total?: number
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_type?: string | null
          priority_score?: number
          processing_diagnostics?: Json | null
          processing_timeout_occurred?: boolean | null
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
            foreignKeyName: "payments_hospital_id_fkey"
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
          id?: string
          pendencia_id?: string
          priority?: string
          reason?: string
          recipient_role?: string
          recipient_user_id?: string
        }
        Relationships: [
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
          id?: string
          opened_by?: string
          pendencia_id?: string
          reason?: string
        }
        Relationships: []
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          deductions_applied: Json
          hospital_id: string | null
          id: string
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
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          deductions_applied?: Json
          hospital_id?: string | null
          id?: string
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
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          deductions_applied?: Json
          hospital_id?: string | null
          id?: string
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
            foreignKeyName: "pool_calculation_runs_pool_id_fkey"
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
          hospital_id: string | null
          id: string
          obrigatoria: boolean
          ordem: number
          pool_id: string
          tipo: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          descricao: string
          hospital_id?: string | null
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pool_id: string
          tipo: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          descricao?: string
          hospital_id?: string | null
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pool_id?: string
          tipo?: string
          updated_at?: string
          valor?: number | null
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
      pool_participants: {
        Row: {
          company_id: string | null
          created_at: string
          hospital_id: string | null
          id: string
          ordem_exibicao: number
          participant_type: string
          percentual: number
          pool_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          hospital_id?: string | null
          id?: string
          ordem_exibicao?: number
          participant_type?: string
          percentual: number
          pool_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          hospital_id?: string | null
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
          hospital_id: string | null
          id: string
          nome: string
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
          hospital_id?: string | null
          id?: string
          nome: string
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
          hospital_id?: string | null
          id?: string
          nome?: string
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
      procedure_classifications: {
        Row: {
          active: boolean
          code_tuss: string
          confidence: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
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
          observation?: string | null
          sector_classified?: string
          updated_at?: string
        }
        Relationships: []
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          company_name: string | null
          created_at: string
          diferenca_regra: number | null
          doctor_name: string | null
          hospital_id: string | null
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
          company_name?: string | null
          created_at?: string
          diferenca_regra?: number | null
          doctor_name?: string | null
          hospital_id?: string | null
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
          company_name?: string | null
          created_at?: string
          diferenca_regra?: number | null
          doctor_name?: string | null
          hospital_id?: string | null
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
      rule_calculations: {
        Row: {
          acrescimo_pct: number | null
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
          context_conditions: Json
          convenio_percentage: number | null
          created_at: string
          deflator_pct: number | null
          doctor_roles: string[] | null
          elective_mode: string
          extras_codes: string[] | null
          fixed_amount: number | null
          force_totalized: boolean | null
          has_conditions: boolean | null
          hospital_id: string | null
          id: string
          include_auxiliaries: boolean
          includes_holidays: boolean
          instrumentador_pct: number | null
          label: string | null
          multiplier: number | null
          package_amount: number | null
          package_auxiliaries_included: boolean
          package_included_codes: string[] | null
          package_main_code: string | null
          package_opinions_count: boolean
          package_subtype: string | null
          package_visits_count: boolean
          procedure_codes: string[] | null
          procedure_keywords: string[] | null
          reference_table_id: string | null
          repasse_pct: number | null
          rule_id: string
          sectors: string[] | null
          sort_order: number
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
          context_conditions?: Json
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
          hospital_id?: string | null
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          label?: string | null
          multiplier?: number | null
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          procedure_codes?: string[] | null
          procedure_keywords?: string[] | null
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_id: string
          sectors?: string[] | null
          sort_order?: number
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
          context_conditions?: Json
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
          hospital_id?: string | null
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          label?: string | null
          multiplier?: number | null
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          procedure_codes?: string[] | null
          procedure_keywords?: string[] | null
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_id?: string
          sectors?: string[] | null
          sort_order?: number
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
          calculation_type: Database["public"]["Enums"]["rule_calculation_type"]
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
          hospital_id: string | null
          id: string
          include_auxiliaries: boolean
          includes_holidays: boolean
          instrumentador_pct: number | null
          limiar_alerta_tipo:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor: number | null
          limiar_bloqueio_tipo:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor: number | null
          multiplier: number | null
          name: string
          package_amount: number | null
          package_auxiliaries_included: boolean
          package_included_codes: string[] | null
          package_main_code: string | null
          package_opinions_count: boolean
          package_subtype: string | null
          package_visits_count: boolean
          reference_table_id: string | null
          repasse_pct: number | null
          rule_text: string
          scope: Database["public"]["Enums"]["rule_scope"]
          severity: Database["public"]["Enums"]["rule_severity"]
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
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
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
          hospital_id?: string | null
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          limiar_alerta_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor?: number | null
          limiar_bloqueio_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor?: number | null
          multiplier?: number | null
          name: string
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_text: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          severity?: Database["public"]["Enums"]["rule_severity"]
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
          calculation_type?: Database["public"]["Enums"]["rule_calculation_type"]
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
          hospital_id?: string | null
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          instrumentador_pct?: number | null
          limiar_alerta_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_alerta_valor?: number | null
          limiar_bloqueio_tipo?:
            | Database["public"]["Enums"]["threshold_type"]
            | null
          limiar_bloqueio_valor?: number | null
          multiplier?: number | null
          name?: string
          package_amount?: number | null
          package_auxiliaries_included?: boolean
          package_included_codes?: string[] | null
          package_main_code?: string | null
          package_opinions_count?: boolean
          package_subtype?: string | null
          package_visits_count?: boolean
          reference_table_id?: string | null
          repasse_pct?: number | null
          rule_text?: string
          scope?: Database["public"]["Enums"]["rule_scope"]
          severity?: Database["public"]["Enums"]["rule_severity"]
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
          id?: string
          sector_slug?: string
          source?: string
          state_uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sector_aliases_sector_slug_fkey"
            columns: ["sector_slug"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["slug"]
          },
        ]
      }
      sectors: {
        Row: {
          active: boolean
          aliases: string[]
          classification: string | null
          code: string
          created_at: string
          deactivated_at: string | null
          name: string
          notes: string | null
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
          deactivated_at?: string | null
          name: string
          notes?: string | null
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
          deactivated_at?: string | null
          name?: string
          notes?: string | null
          slug?: string
          sort_order?: number
          state_uf?: string | null
          tasy_code?: string | null
          updated_at?: string
        }
        Relationships: []
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
      status_anomalies: {
        Row: {
          context: Json
          created_at: string
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
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
          hospital_id: string | null
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
          hospital_id?: string | null
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
          hospital_id?: string | null
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
        ]
      }
    }
    Functions: {
      accept_payment_item: {
        Args: { _item_id: string; _justification: string }
        Returns: Json
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
      apply_rule_save_with_corrections: {
        Args: { _calculations: Json; _corrections: Json; _rule_data: Json }
        Returns: Json
      }
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
      backfill_payment_items_engine_columns: {
        Args: { _dry_run?: boolean }
        Returns: Json
      }
      calculate_payment_audit: { Args: { p_payment_id: string }; Returns: Json }
      calculate_payment_priority: {
        Args: { _payment_id: string }
        Returns: number
      }
      can_access_hospital: {
        Args: { _hid: string; _uid: string }
        Returns: boolean
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
        Args: { _doctor_id: string; _on_date: string }
        Returns: {
          company_id: string
        }[]
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
      delete_payment_batch: { Args: { p_payment_id: string }; Returns: Json }
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
      get_doctor_activity_log: {
        Args: { p_doctor_id: string; p_limit?: number }
        Returns: Json
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
      get_dre_consolidated: {
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
      get_dre_drilldown: {
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
      get_journal_balance: {
        Args: {
          p_company_id?: string
          p_competencia_from?: string
          p_competencia_to?: string
          p_doctor_id?: string
        }
        Returns: number
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
      get_money_funnel: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          avg_age_days: number
          payment_count: number
          stage: string
          stage_order: number
          total_value: number
        }[]
      }
      get_open_position: {
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
      get_payment_pivot:
        | {
            Args: {
              p_current_month: string
              p_grouping: string
              p_months_back: number
              p_secondary?: string
            }
            Returns: {
              group_key: string
              month_bucket: string
              parent_key: string
              total: number
            }[]
          }
        | {
            Args: {
              p_current_month: string
              p_grouping: string
              p_months_back: number
              p_payment_id?: string
              p_secondary?: string
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
      get_spend_trend: {
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
          hospital_id: string | null
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
      is_any_company_portal_user: { Args: { _uid: string }; Returns: boolean }
      is_any_doctor_portal_user: { Args: { _uid: string }; Returns: boolean }
      is_company_portal_user: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_feature_enabled: {
        Args: { _key: string; _user_id: string }
        Returns: boolean
      }
      is_global_role: { Args: { _uid: string }; Returns: boolean }
      is_payment_in_analyst_phase: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      is_portal_user: { Args: { _uid: string }; Returns: boolean }
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
      map_calculation_type_to_method: {
        Args: { _ctype: string }
        Returns: string
      }
      mark_all_doctor_notifications_read: { Args: never; Returns: number }
      mark_doctor_notification_read: {
        Args: { p_id: string }
        Returns: boolean
      }
      mark_portal_thread_read: {
        Args: { p_payment_id: string; p_payment_item_id?: string }
        Returns: number
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
      question_company_group: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_company_group_id: string
          p_message: string
        }
        Returns: string
      }
      recalc_payment_priority: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      recompute_payment_liquido: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      recompute_payment_status_from_groups: {
        Args: { _payment_id: string }
        Returns: undefined
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
      repair_portal_links: { Args: never; Returns: Json }
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
      resolve_glosa_to_company: {
        Args: { _debt_id: string }
        Returns: undefined
      }
      return_groups_to_analyst: {
        Args: {
          p_author_id: string
          p_author_name: string
          p_group_ids: string[]
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
      set_primary_hospital_for_user: {
        Args: {
          _hospital_id: string
          _role?: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      state_scope_allows: { Args: { _state_uf: string }; Returns: boolean }
      unaccent: { Args: { "": string }; Returns: string }
      undo_accept_payment_item: { Args: { _item_id: string }; Returns: Json }
      unignore_glosa_debt: { Args: { _debt_id: string }; Returns: undefined }
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
      user_belongs_to_company: {
        Args: { _company_id: string }
        Returns: boolean
      }
      user_hospital_ids: { Args: { _user_id: string }; Returns: string[] }
      user_state_ufs: { Args: { _uid: string }; Returns: string[] }
      validate_rule_save: {
        Args: {
          _group_company_links: Json
          _group_doctors: Json
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
    }
    Enums: {
      app_role:
        | "admin"
        | "diretor"
        | "validador"
        | "analista"
        | "empresa"
        | "medico"
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
      payment_kind: "atual" | "pendencia" | "misto"
      payment_status:
        | "rascunho"
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
      portal_link_health: "ok" | "orphan_user" | "orphan_target" | "inactive"
      reference_table_kind:
        | "simples"
        | "cbhpm"
        | "tabela_propria"
        | "lista_codigos"
        | "pacote_combinacao"
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
      rule_target_type: "medico" | "empresa"
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
      ],
      payment_kind: ["atual", "pendencia", "misto"],
      payment_status: [
        "rascunho",
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
      ],
      portal_link_health: ["ok", "orphan_user", "orphan_target", "inactive"],
      reference_table_kind: [
        "simples",
        "cbhpm",
        "tabela_propria",
        "lista_codigos",
        "pacote_combinacao",
      ],
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
      rule_target_type: ["medico", "empresa"],
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
