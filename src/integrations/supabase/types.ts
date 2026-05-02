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
          name?: string
          notes?: string | null
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
          payment_id: string
          received_amount: number | null
          received_at: string | null
          recipient_email: string
          reconciliation_notes: string | null
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
          payment_id: string
          received_amount?: number | null
          received_at?: string | null
          recipient_email: string
          reconciliation_notes?: string | null
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
          payment_id?: string
          received_amount?: number | null
          received_at?: string | null
          recipient_email?: string
          reconciliation_notes?: string | null
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
      payment_items: {
        Row: {
          access_route: string | null
          agreement_text: string | null
          ai_findings: Json | null
          ai_status: Database["public"]["Enums"]["item_ai_status"]
          attendance_number: string | null
          company_id: string | null
          company_name: string | null
          cost_center_code: string | null
          created_at: string
          description: string | null
          doctor_document: string | null
          doctor_email: string | null
          doctor_name: string
          doctor_role: string | null
          gross_amount: number
          id: string
          payment_id: string
          procedure_amount: number | null
          procedure_code: string | null
          procedure_date: string | null
          procedure_name: string | null
          quantity: number | null
          raw_data: Json | null
        }
        Insert: {
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          attendance_number?: string | null
          company_id?: string | null
          company_name?: string | null
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name: string
          doctor_role?: string | null
          gross_amount?: number
          id?: string
          payment_id: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          raw_data?: Json | null
        }
        Update: {
          access_route?: string | null
          agreement_text?: string | null
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          attendance_number?: string | null
          company_id?: string | null
          company_name?: string | null
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name?: string
          doctor_role?: string | null
          gross_amount?: number
          id?: string
          payment_id?: string
          procedure_amount?: number | null
          procedure_code?: string | null
          procedure_date?: string | null
          procedure_name?: string | null
          quantity?: number | null
          raw_data?: Json | null
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
          author_id: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at: string
          edited_at: string | null
          id: string
          item_id: string | null
          message: string
          payment_id: string
          status_from: Database["public"]["Enums"]["payment_status"] | null
          status_to: Database["public"]["Enums"]["payment_status"] | null
        }
        Insert: {
          author_id?: string | null
          author_type: Database["public"]["Enums"]["observation_author"]
          created_at?: string
          edited_at?: string | null
          id?: string
          item_id?: string | null
          message: string
          payment_id: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
        }
        Update: {
          author_id?: string | null
          author_type?: Database["public"]["Enums"]["observation_author"]
          created_at?: string
          edited_at?: string | null
          id?: string
          item_id?: string | null
          message?: string
          payment_id?: string
          status_from?: Database["public"]["Enums"]["payment_status"] | null
          status_to?: Database["public"]["Enums"]["payment_status"] | null
        }
        Relationships: [
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
      payments: {
        Row: {
          ai_summary: string | null
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
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
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
          port: string | null
          port_multiplier: number
          reference_table_id: string
        }
        Insert: {
          amount?: number | null
          aux_count?: number | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          port?: string | null
          port_multiplier?: number
          reference_table_id: string
        }
        Update: {
          amount?: number | null
          aux_count?: number | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          port?: string | null
          port_multiplier?: number
          reference_table_id?: string
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
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["reference_table_kind"]
          name: string
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reference_table_kind"]
          name: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["reference_table_kind"]
          name?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      rules: {
        Row: {
          active: boolean
          applies_payment_types:
            | Database["public"]["Enums"]["payment_type"][]
            | null
          auxiliary_pct: number | null
          bonus_amount: number | null
          bonus_pct: number | null
          created_at: string
          created_by: string | null
          deflator_pct: number | null
          description: string | null
          doctors: Json
          elective_mode: string
          id: string
          include_auxiliaries: boolean
          includes_holidays: boolean
          multiplier: number | null
          name: string
          package_amount: number | null
          payment_term: Database["public"]["Enums"]["rule_payment_term"]
          procedure_codes: string[] | null
          reference_table_id: string | null
          rule_json: Json | null
          rule_text: string
          rule_type: Database["public"]["Enums"]["rule_type"]
          scope: Database["public"]["Enums"]["rule_scope"]
          sector: Database["public"]["Enums"]["rule_sector"]
          sectors: string[]
          severity: Database["public"]["Enums"]["rule_severity"]
          specialties: string[]
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
          applies_payment_types?:
            | Database["public"]["Enums"]["payment_type"][]
            | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          created_at?: string
          created_by?: string | null
          deflator_pct?: number | null
          description?: string | null
          doctors?: Json
          elective_mode?: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          multiplier?: number | null
          name: string
          package_amount?: number | null
          payment_term?: Database["public"]["Enums"]["rule_payment_term"]
          procedure_codes?: string[] | null
          reference_table_id?: string | null
          rule_json?: Json | null
          rule_text: string
          rule_type?: Database["public"]["Enums"]["rule_type"]
          scope?: Database["public"]["Enums"]["rule_scope"]
          sector?: Database["public"]["Enums"]["rule_sector"]
          sectors?: string[]
          severity?: Database["public"]["Enums"]["rule_severity"]
          specialties?: string[]
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
          applies_payment_types?:
            | Database["public"]["Enums"]["payment_type"][]
            | null
          auxiliary_pct?: number | null
          bonus_amount?: number | null
          bonus_pct?: number | null
          created_at?: string
          created_by?: string | null
          deflator_pct?: number | null
          description?: string | null
          doctors?: Json
          elective_mode?: string
          id?: string
          include_auxiliaries?: boolean
          includes_holidays?: boolean
          multiplier?: number | null
          name?: string
          package_amount?: number | null
          payment_term?: Database["public"]["Enums"]["rule_payment_term"]
          procedure_codes?: string[] | null
          reference_table_id?: string | null
          rule_json?: Json | null
          rule_text?: string
          rule_type?: Database["public"]["Enums"]["rule_type"]
          scope?: Database["public"]["Enums"]["rule_scope"]
          sector?: Database["public"]["Enums"]["rule_sector"]
          sectors?: string[]
          severity?: Database["public"]["Enums"]["rule_severity"]
          specialties?: string[]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      only_digits: { Args: { txt: string }; Returns: string }
      recompute_payment_status_from_groups: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      revert_cost_center_import: { Args: { _import_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "diretor" | "validador" | "analista"
      invoice_status: "aguardando" | "recebida" | "conciliada" | "divergente"
      item_ai_status: "pendente" | "aprovado" | "alerta" | "reprovado"
      observation_author:
        | "ia"
        | "analista"
        | "validador"
        | "diretor"
        | "sistema"
      payment_kind: "atual" | "pendencia" | "misto"
      payment_status:
        | "rascunho"
        | "em_analise_ia"
        | "aguardando_validacao"
        | "devolvido_analista"
        | "aguardando_aprovacao"
        | "devolvido_validador"
        | "aprovado"
        | "pedido_nf_enviado"
        | "nf_recebida"
        | "nf_conciliada"
        | "nf_divergente"
        | "pago"
        | "rejeitado"
        | "cancelado"
        | "revisao_analista"
        | "aprovado_com_ressalva"
        | "nf_questionada"
      payment_type: "producao" | "remessa" | "valor_fixo" | "plantao"
      reference_table_kind: "simples" | "cbhpm"
      rule_payment_term: "qualquer" | "prioridade" | "habitual"
      rule_scope: "master" | "especifica"
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
      rule_type:
        | "informativo"
        | "pacote"
        | "tabela_diferenciada"
        | "bonus"
        | "complemento"
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
      item_ai_status: ["pendente", "aprovado", "alerta", "reprovado"],
      observation_author: ["ia", "analista", "validador", "diretor", "sistema"],
      payment_kind: ["atual", "pendencia", "misto"],
      payment_status: [
        "rascunho",
        "em_analise_ia",
        "aguardando_validacao",
        "devolvido_analista",
        "aguardando_aprovacao",
        "devolvido_validador",
        "aprovado",
        "pedido_nf_enviado",
        "nf_recebida",
        "nf_conciliada",
        "nf_divergente",
        "pago",
        "rejeitado",
        "cancelado",
        "revisao_analista",
        "aprovado_com_ressalva",
        "nf_questionada",
      ],
      payment_type: ["producao", "remessa", "valor_fixo", "plantao"],
      reference_table_kind: ["simples", "cbhpm"],
      rule_payment_term: ["qualquer", "prioridade", "habitual"],
      rule_scope: ["master", "especifica"],
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
      rule_type: [
        "informativo",
        "pacote",
        "tabela_diferenciada",
        "bonus",
        "complemento",
      ],
    },
  },
} as const
