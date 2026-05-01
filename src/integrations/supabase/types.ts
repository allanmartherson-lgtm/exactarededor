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
      invoices: {
        Row: {
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
      payment_items: {
        Row: {
          ai_findings: Json | null
          ai_status: Database["public"]["Enums"]["item_ai_status"]
          created_at: string
          description: string | null
          doctor_document: string | null
          doctor_email: string | null
          doctor_name: string
          gross_amount: number
          id: string
          payment_id: string
          raw_data: Json | null
        }
        Insert: {
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name: string
          gross_amount?: number
          id?: string
          payment_id: string
          raw_data?: Json | null
        }
        Update: {
          ai_findings?: Json | null
          ai_status?: Database["public"]["Enums"]["item_ai_status"]
          created_at?: string
          description?: string | null
          doctor_document?: string | null
          doctor_email?: string | null
          doctor_name?: string
          gross_amount?: number
          id?: string
          payment_id?: string
          raw_data?: Json | null
        }
        Relationships: [
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
          created_at: string
          created_by: string
          description: string | null
          id: string
          items_count: number
          reference: string
          source_file_path: string | null
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
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          items_count?: number
          reference: string
          source_file_path?: string | null
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
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          items_count?: number
          reference?: string
          source_file_path?: string | null
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
      rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          rule_json: Json | null
          rule_text: string
          severity: Database["public"]["Enums"]["rule_severity"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          rule_json?: Json | null
          rule_text: string
          severity?: Database["public"]["Enums"]["rule_severity"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          rule_json?: Json | null
          rule_text?: string
          severity?: Database["public"]["Enums"]["rule_severity"]
          updated_at?: string
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
      rule_severity: "info" | "aviso" | "bloqueio"
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
      ],
      rule_severity: ["info", "aviso", "bloqueio"],
    },
  },
} as const
