// Tipos e rótulos do Cadastro de Acordos (agreement_registrations).
// A tabela é rascunho/wizard; ao final do fluxo de aprovação gera uma regra em `rules`.

export type AgreementStatus =
  | "rascunho"
  | "aguardando_supervisor"
  | "aguardando_diretor"
  | "aprovado"
  | "rejeitado"
  | "cadastrado";

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  rascunho: "Rascunho",
  aguardando_supervisor: "Aguardando supervisor",
  aguardando_diretor: "Aguardando diretor",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cadastrado: "Cadastrado",
};

export const AGREEMENT_STATUS_VARIANT: Record<
  AgreementStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  rascunho: "secondary",
  aguardando_supervisor: "outline",
  aguardando_diretor: "outline",
  aprovado: "default",
  rejeitado: "destructive",
  cadastrado: "default",
};

export const PAYMENT_TABLE_BASE_LABEL: Record<string, string> = {
  cbhpm_2018: "CBHPM 2018",
  tabela_convenio: "Tabela do convênio",
  outra: "Outra",
};

export interface ExtraItem {
  label: string;
  value: string;
}

export interface AgreementRegistration {
  id: string;
  code: string;
  hospital_id: string;
  company_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  filled_by: string | null;
  applies_to_all_convenios: boolean;
  convenio_exceptions: string[];
  applies_to_all_doctors: boolean;
  doctor_exceptions: string[];
  includes_auxiliary: boolean;
  includes_access_route: boolean;
  payment_table_base: string | null;
  payment_percentage: number | null;
  has_glosa: boolean;
  glosa_conditions: string | null;
  urgency_differentiation: boolean;
  urgency_addition_pct: number | null;
  weekend_holiday_addition: boolean;
  weekend_holiday_addition_pct: number | null;
  has_fixed_values: boolean;
  fixed_value_urgency_differentiation: boolean;
  exclusions_notes: string | null;
  extra_items: ExtraItem[];
  free_notes: string | null;
  status: AgreementStatus;
  created_at: string;
  updated_at: string;
}
