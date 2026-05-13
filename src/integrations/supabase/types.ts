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
        Relationships: []
      }
      ai_analysis_versions: {
        Row: {
          ai_status: string
          alerts: Json
          calculation_explanation: string | null
          created_at: string
          expected_amount: number | null
          gross_amount_at_time: number | null
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
          id?: string
          item_id?: string
          matched_rule_ids?: Json
          matched_rules?: Json
          model?: string | null
          payment_id?: string
          triggered_by?: string | null
          version?: number
        }
        Relationships: []
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
          id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          aliases: string[]
          created_at: string
          created_by: string | null
          document: string | null
          id: string
          invoice_emails: string[]
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          created_by?: string | null
          document?: string | null
          id?: string
          invoice_emails?: string[]
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          created_by?: string | null
          document?: string | null
          id?: string
          invoice_emails?: string[]
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_sla_overrides: {
        Row: {
          company_id: string
          created_at: string
          due_day: number | null
          due_offset_days: number | null
          due_rule: string
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
          id?: string
          inherit_default?: boolean
          notes?: string | null
          priority?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_center_imports: {
        Row: {
          created_count: number
          deactivated_count: number
          file_name: string | null
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
        Relationships: []
      }
      cost_centers: {
        Row: {
          active: boolean
          code_p10: string | null
          code_p12: string
          code_pai: string | null
          created_at: string
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
          code_p10?: string | null
          code_p12: string
          code_pai?: string | null
          created_at?: string
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
          code_p10?: string | null
          code_p12?: string
          code_pai?: string | null
          created_at?: string
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
        Relationships: []
      }
      doctor_companies: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          doctor_id: string
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          doctor_id: string
          id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          id?: string
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
      doctors: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          crm: string
          crm_uf: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          specialties: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          crm: string
          crm_uf: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          specialties?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          crm?: string
          crm_uf?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          specialties?: string[]
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
          author_id: string | null
          author_name: string | null
          author_type: string
          created_at: string
          id: string
          invoice_id: string
          message: string
          payment_id: string
          read_at: string | null
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          author_type: string
          created_at?: string
          id?: string
          invoice_id: string
          message: string
          payment_id: string
          read_at?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          author_type?: string
          created_at?: string
          id?: string
          invoice_id?: string
          message?: string
          payment_id?: string
          read_at?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          ai_extracted_amount: number | null
          ai_extracted_cnpj: string | null
          ai_extracted_number: string | null
          ai_validated_at: string | null
          ai_validation: Json | null
          company_id: string | null
          company_name: string | null
          created_at: string
          expected_amount: number
          file_path: string | null
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
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          expected_amount: number
          file_path?: string | null
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
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          expected_amount?: number
          file_path?: string | null
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
            foreignKeyName: "invoices_payment_id_fkey"
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
          id?: string
          note?: string | null
          payment_id?: string
          previous_analyst_id?: string | null
          source?: string
        }
        Relationships: []
      }
      payment_company_groups: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string | null
          company_name: string
          created_at: string
          id: string
          items_count: number
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
          company_id?: string | null
          company_name: string
          created_at?: string
          id?: string
          items_count?: number
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
          company_id?: string | null
          company_name?: string
          created_at?: string
          id?: string
          items_count?: number
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
        Relationships: []
      }
      payment_director_notifications: {
        Row: {
          email_results: Json
          id: string
          notified_at: string
          payment_id: string
          whatsapp_results: Json
        }
        Insert: {
          email_results?: Json
          id?: string
          notified_at?: string
          payment_id: string
          whatsapp_results?: Json
        }
        Update: {
          email_results?: Json
          id?: string
          notified_at?: string
          payment_id?: string
          whatsapp_results?: Json
        }
        Relationships: []
      }
      payment_items: {
        Row: {
          access_route: string | null
          agreement_text: string | null
          ai_findings: Json | null
          ai_status: Database["public"]["Enums"]["item_ai_status"]
          applied_at: string | null
          applied_calc_id: string | null
          applied_calc_method: string | null
          applied_rule_id: string | null
          applied_rule_label: string | null
          attendance_group_key: string | null
          attendance_number: string | null
          authorized_exception: boolean
          company_id: string | null
          company_name: string | null
          complement_reason: string | null
          convenio_value_totalized: boolean
          cost_center_code: string | null
          created_at: string
          description: string | null
          doctor_document: string | null
          doctor_email: string | null
          doctor_name: string
          doctor_role: string | null
          exception_attachment_path: string | null
          exception_authorizer: string | null
          exception_marked_at: string | null
          exception_marked_by: string | null
          exception_note: string | null
          exception_reason: string | null
          expected_amount: number | null
          gross_amount: number
          id: string
          item_hash: string | null
          patient_name: string | null
          payment_id: string
          procedure_amount: number | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_name: string | null
          quantity: number | null
          raw_data: Json | null
          sector: string | null
          specialty: string | null
          tipo_item: string | null
          tipo_linha: string | null
        }
        Insert: {
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          applied_at?: string | null
          applied_calc_id?: string | null
          applied_calc_method?: string | null
          applied_rule_id?: string | null
          applied_rule_label?: string | null
          attendance_group_key?: string | null
          attendance_number?: string | null
          authorized_exception?: boolean
          company_id?: string | null
          company_name?: string | null
          complement_reason?: string | null
          convenio_value_totalized?: boolean
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name: string
          doctor_role?: string | null
          exception_attachment_path?: string | null
          exception_authorizer?: string | null
          exception_marked_at?: string | null
          exception_marked_by?: string | null
          exception_note?: string | null
          exception_reason?: string | null
          expected_amount?: number | null
          gross_amount?: number
          id?: string
          item_hash?: string | null
          patient_name?: string | null
          payment_id: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          raw_data?: Json | null
          sector?: string | null
          specialty?: string | null
          tipo_item?: string | null
          tipo_linha?: string | null
        }
        Update: {
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          applied_at?: string | null
          applied_calc_id?: string | null
          applied_calc_method?: string | null
          applied_rule_id?: string | null
          applied_rule_label?: string | null
          attendance_group_key?: string | null
          attendance_number?: string | null
          authorized_exception?: boolean
          company_id?: string | null
          company_name?: string | null
          complement_reason?: string | null
          convenio_value_totalized?: boolean
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name?: string
          doctor_role?: string | null
          exception_attachment_path?: string | null
          exception_authorizer?: string | null
          exception_marked_at?: string | null
          exception_marked_by?: string | null
          exception_note?: string | null
          exception_reason?: string | null
          expected_amount?: number | null
          gross_amount?: number
          id?: string
          item_hash?: string | null
          patient_name?: string | null
          payment_id?: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          raw_data?: Json | null
          sector?: string | null
          specialty?: string | null
          tipo_item?: string | null
          tipo_linha?: string | null
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
            foreignKeyName: "payment_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
      payment_observations: {
        Row: {
          answered_by_observation_id: string | null
          author_id: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at: string
          edited_at: string | null
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
            foreignKeyName: "payment_observations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "payment_items"
            referencedColumns: ["id"]
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
      payment_processing_jobs: {
        Row: {
          created_at: string
          failed_companies: Json
          finished_at: string | null
          id: string
          payment_id: string
          processed_companies: number
          started_at: string
          status: string
          total_companies: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_companies?: Json
          finished_at?: string | null
          id?: string
          payment_id: string
          processed_companies?: number
          started_at?: string
          status?: string
          total_companies?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_companies?: Json
          finished_at?: string | null
          id?: string
          payment_id?: string
          processed_companies?: number
          started_at?: string
          status?: string
          total_companies?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          payment_id: string
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          payment_id: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          payment_id?: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: []
      }
      payments: {
        Row: {
          ai_summary: string | null
          analysis_mode: Database["public"]["Enums"]["payment_analysis_mode"]
          approval_pdf_path: string | null
          approved_at: string | null
          approved_by: string | null
          competence_month: string | null
          competence_months: string[]
          cost_center_code: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          items_count: number
          payment_due_date: string | null
          payment_kind: Database["public"]["Enums"]["payment_kind"] | null
          payment_type: Database["public"]["Enums"]["payment_type"] | null
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
          competence_month?: string | null
          competence_months?: string[]
          cost_center_code?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          items_count?: number
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_type?: Database["public"]["Enums"]["payment_type"] | null
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
          competence_month?: string | null
          competence_months?: string[]
          cost_center_code?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          items_count?: number
          payment_due_date?: string | null
          payment_kind?: Database["public"]["Enums"]["payment_kind"] | null
          payment_type?: Database["public"]["Enums"]["payment_type"] | null
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
        Relationships: []
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
      profiles: {
        Row: {
          birth_date: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string | null
          id: string
          phone: string | null
          preferences: Json
          role_title: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          preferences?: Json
          role_title?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          preferences?: Json
          role_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_table_items: {
        Row: {
          amount: number | null
          aux_count: number | null
          code: string
          created_at: string
          description: string | null
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
          id: string
          port: string
          reference_table_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          port: string
          reference_table_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          port?: string
          reference_table_id?: string
        }
        Relationships: [
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
        Relationships: []
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
          convenio_percentage: number | null
          created_at: string
          deflator_pct: number | null
          doctor_roles: string[] | null
          elective_mode: string
          extras_codes: string[] | null
          fixed_amount: number | null
          force_totalized: boolean | null
          has_conditions: boolean | null
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
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
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
          convenio_percentage?: number | null
          created_at?: string
          deflator_pct?: number | null
          doctor_roles?: string[] | null
          elective_mode?: string
          extras_codes?: string[] | null
          fixed_amount?: number | null
          force_totalized?: boolean | null
          has_conditions?: boolean | null
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
            foreignKeyName: "rule_calculations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
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
        ]
      }
      sla_settings: {
        Row: {
          active: boolean
          business_days: number
          created_at: string
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
          id?: string
          severity?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          warning_pct?: number
        }
        Relationships: []
      }
      status_anomalies: {
        Row: {
          context: Json
          created_at: string
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      backfill_payment_items_engine_columns: {
        Args: { _dry_run?: boolean }
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
          doctor_crms: string[]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_processing_progress: {
        Args: { _company_name: string; _error?: string; _job_id: string }
        Returns: {
          created_at: string
          failed_companies: Json
          finished_at: string | null
          id: string
          payment_id: string
          processed_companies: number
          started_at: string
          status: string
          total_companies: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_processing_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_valid_status_transition: {
        Args: {
          _from: Database["public"]["Enums"]["payment_status"]
          _to: Database["public"]["Enums"]["payment_status"]
        }
        Returns: boolean
      }
      map_calculation_type_to_method: {
        Args: { _ctype: string }
        Returns: string
      }
      norm_for_hash: { Args: { s: string }; Returns: string }
      only_digits: { Args: { txt: string }; Returns: string }
      recompute_payment_status_from_groups: {
        Args: { _payment_id: string }
        Returns: undefined
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
      revert_cost_center_import: { Args: { _import_id: string }; Returns: Json }
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
      app_role: "admin" | "diretor" | "validador" | "analista"
      invoice_status: "aguardando" | "recebida" | "conciliada" | "divergente"
      item_ai_status:
        | "pendente"
        | "aprovado"
        | "alerta"
        | "reprovado"
        | "erro_duplicidade_pagamento"
        | "erro_duplicidade_calculo"
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
      payment_analysis_mode: "padrao" | "empresa_prioritaria" | "isolado"
      payment_kind: "atual" | "pendencia" | "misto"
      payment_status:
        | "rascunho"
        | "em_analise_ia"
        | "revisao_analista"
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
      payment_type: "producao" | "remessa" | "valor_fixo" | "plantao"
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
      rule_severity: "info" | "aviso" | "bloqueio"
      rule_target_type: "medico" | "empresa"
      threshold_type: "percentual" | "absoluto"
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
      app_role: ["admin", "diretor", "validador", "analista"],
      invoice_status: ["aguardando", "recebida", "conciliada", "divergente"],
      item_ai_status: [
        "pendente",
        "aprovado",
        "alerta",
        "reprovado",
        "erro_duplicidade_pagamento",
        "erro_duplicidade_calculo",
      ],
      observation_author: ["ia", "analista", "validador", "diretor", "sistema"],
      observation_type: [
        "informativo",
        "impacta_aprovacao",
        "justificativa_override",
      ],
      payment_analysis_mode: ["padrao", "empresa_prioritaria", "isolado"],
      payment_kind: ["atual", "pendencia", "misto"],
      payment_status: [
        "rascunho",
        "em_analise_ia",
        "revisao_analista",
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
      ],
      payment_type: ["producao", "remessa", "valor_fixo", "plantao"],
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
      ],
      rule_severity: ["info", "aviso", "bloqueio"],
      rule_target_type: ["medico", "empresa"],
      threshold_type: ["percentual", "absoluto"],
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
