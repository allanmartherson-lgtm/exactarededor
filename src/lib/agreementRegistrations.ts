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

export function parseExtraItems(raw: unknown): ExtraItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({ label: String(i.label ?? ""), value: String(i.value ?? "") }));
}

/** Tipo de comunicado: acordo novo, aditivo ou retirada de acordo anterior. */
export type AgreementRegistrationType = "novo_acordo" | "aditivo" | "retirada";

export const AGREEMENT_TYPE_LABEL: Record<AgreementRegistrationType, string> = {
  novo_acordo: "Novo acordo",
  aditivo: "Aditivo a acordo existente",
  retirada: "Retirada de acordo",
};

/** PJ envolvida no acordo. doctor_id nulo = todos os médicos daquela PJ. */
export interface AgreementPartyRow {
  id: string;
  agreement_id: string;
  company_id: string;
  doctor_id: string | null;
  created_at: string;
}

export interface AgreementRegistration {
  id: string;
  code: string;
  hospital_id: string;
  company_id: string | null;
  registration_type: AgreementRegistrationType;
  reference_note: string | null;
  related_agreement_id: string | null;
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

// ---------------------------------------------------------------------------
// Fluxo de aprovação (supervisor → diretores por hospital → analista)
// ---------------------------------------------------------------------------

export type AgreementHospitalStatus = "aguardando_diretor" | "aprovado" | "rejeitado";

export const AGREEMENT_HOSPITAL_STATUS_LABEL: Record<string, string> = {
  aguardando_diretor: "Aguardando diretor",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

export interface AgreementHospitalRow {
  id: string;
  agreement_id: string;
  hospital_id: string;
  is_primary: boolean;
  status: AgreementHospitalStatus;
  director_id: string | null;
  director_approved_at: string | null;
  director_notes: string | null;
  rejection_reason: string | null;
  linked_rule_id: string | null;
  created_at: string;
}

/** Campos de auditoria do fluxo, lidos junto do registro principal. */
export interface AgreementFlowFields {
  supervisor_id: string | null;
  supervisor_validated_at: string | null;
  supervisor_notes: string | null;
  analyst_id: string | null;
  analyst_registered_at: string | null;
  rejection_reason: string | null;
  pdf_url: string | null;
}

/** Histórico imutável de ciclos anteriores (rejeições e reenvios). */
export type AgreementEventType = "rejeicao_diretor" | "reenvio_contratos";

export const AGREEMENT_EVENT_LABEL: Record<AgreementEventType, string> = {
  rejeicao_diretor: "Rejeitado pelo diretor",
  reenvio_contratos: "Corrigido e reenviado pelo Contratos",
};

export interface AgreementEventRow {
  id: string;
  agreement_id: string;
  hospital_id: string | null;
  cycle: number;
  event_type: AgreementEventType;
  actor_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface ChecklistEntry {
  key: string;
  label: string;
  ok: boolean;
  /** Bloqueia o avanço quando falso. */
  required: boolean;
}


/**
 * Checklist objetivo que o supervisor precisa conferir antes de encaminhar
 * aos diretores. Só itens verificáveis pelos dados do próprio acordo.
 */
export function buildSupervisorChecklist(
  a: AgreementRegistration,
  hospitals: AgreementHospitalRow[],
): ChecklistEntry[] {
  const hasBase = !!a.payment_table_base;
  const hasPct = a.payment_percentage != null && Number(a.payment_percentage) > 0;
  return [
    { key: "company", label: "Clínica (PJ) vinculada", ok: !!a.company_id, required: true },
    { key: "from", label: "Data de início da vigência", ok: !!a.effective_from, required: true },
    { key: "base", label: "Tabela base definida", ok: hasBase, required: true },
    {
      key: "value",
      label: "Percentual ou valores fixos informados",
      ok: hasPct || a.has_fixed_values || a.extra_items.length > 0,
      required: true,
    },
    { key: "hospitals", label: "Ao menos um hospital de destino", ok: hospitals.length > 0, required: true },
    {
      key: "glosa",
      label: "Condições de glosa descritas (quando há glosa)",
      ok: !a.has_glosa || !!(a.glosa_conditions ?? "").trim(),
      required: true,
    },
    {
      key: "urgency",
      label: "Adicional de urgência com percentual",
      ok: !a.urgency_differentiation || a.urgency_addition_pct != null,
      required: false,
    },
    {
      key: "weekend",
      label: "Adicional de fim de semana/feriado com percentual",
      ok: !a.weekend_holiday_addition || a.weekend_holiday_addition_pct != null,
      required: false,
    },
  ];
}

export interface TimelineEntry {
  key: string;
  label: string;
  at: string | null;
  detail?: string | null;
  state: "done" | "current" | "pending" | "error";
}

/** Linha do tempo do acordo, usada nas telas de fila e no detalhe. */
export function buildAgreementTimeline(
  a: AgreementRegistration & Partial<AgreementFlowFields>,
  hospitals: AgreementHospitalRow[],
): TimelineEntry[] {
  const rejected = a.status === "rejeitado";
  const approvedCount = hospitals.filter((h) => h.status === "aprovado").length;
  const registeredCount = hospitals.filter((h) => !!h.linked_rule_id).length;
  const step = (
    key: string,
    label: string,
    done: boolean,
    current: boolean,
    at: string | null,
    detail?: string | null,
  ): TimelineEntry => ({
    key,
    label,
    at,
    detail,
    state: done ? "done" : current ? "current" : "pending",
  });
  const entries: TimelineEntry[] = [
    step("draft", "Preenchimento (Contratos)", a.status !== "rascunho", a.status === "rascunho", a.created_at),
    step(
      "supervisor",
      "Validação do supervisor",
      !!a.supervisor_validated_at,
      a.status === "aguardando_supervisor",
      a.supervisor_validated_at ?? null,
      a.supervisor_notes ?? null,
    ),
    step(
      "directors",
      "Aprovação dos diretores",
      hospitals.length > 0 && approvedCount === hospitals.length,
      a.status === "aguardando_diretor",
      null,
      hospitals.length > 0 ? `${approvedCount}/${hospitals.length} hospital(is) aprovado(s)` : null,
    ),
    step(
      "analyst",
      "Cadastro da regra (Analista)",
      a.status === "cadastrado",
      a.status === "aprovado",
      a.analyst_registered_at ?? null,
      hospitals.length > 0 ? `${registeredCount}/${hospitals.length} regra(s) criada(s)` : null,
    ),
  ];
  if (rejected) {
    return entries.map((e) =>
      e.state === "current" || e.state === "pending"
        ? { ...e, state: "error" as const, detail: a.rejection_reason ?? e.detail }
        : e,
    );
  }
  return entries;
}
