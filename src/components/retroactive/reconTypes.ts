import { type TvrStatus } from "@/lib/tvr";

export type ReconMode = "alegacao_medico" | "tasy_vs_repasse";

export type Doctor = { id: string; full_name: string; crm: string; crm_uf: string };

export type Company = { id: string; name: string; document: string | null };

export type ReconRow = {
  id: string;
  doctor_id: string | null;
  company_id: string | null;
  hospital_id?: string | null;
  period_start: string;
  period_end: string;
  status: "em_analise" | "concluida" | "cancelada";
  title: string | null;
  // Origem do lote que gerou a apuração — usado para cruzar centro de custos
  // e trilha (prioritária/habitual) com o lote vigente da PJ na hora da glosa.
  source_payment_id?: string | null;
  cost_center_code?: string | null;
  analysis_mode?: string | null;
  summary: {
    mode?: ReconMode;
    total?: number;
    ok_pago?: number;
    pago_a_menos?: number;
    pago_a_mais?: number;
    nao_pago?: number;
    pago_outro_mes?: number;
    sem_lastro?: number;
    tuss_divergente?: number;
    total_gap?: number;
    total_excess?: number;
    tasy_file?: string;
    exclude_tuss?: string;
    excluded_convenios?: string[];
    processed_at?: string;
    tvr_counts?: Partial<Record<TvrStatus, number>>;
    tvr_ausente_incomplete?: number;
    tvr_validation_history?: Array<Record<string, unknown>>;
    tasy_file_totals?: { file: number; valid: number; excluded: number; dropped: number };
    tasy_dropped_examples?: Array<{ row_index: number; missing: string[] }>;
    // Escopo de PJ na criação
    scope?: "individual" | "multi_pj";
    multi_company_ids?: string[];
    multi_doctor_ids?: string[];
    multi_labels?: { companies?: string[]; doctors?: string[] };
    handoff?: {
      status: "encaminhada";
      payment_id?: string | null;
      payment_reference?: string | null;
      at: string;
      by?: string | null;
      items_count: number;
      total_complementar?: number;
      total_retirar?: number;
      item_keys?: string[];
    };
    // Lotes (payment_ids) que o analista fixou como universo da apuração.
    // Quando presente, o motor filtra por eles em vez do fallback por competência.
    selected_payment_ids?: string[];
    selected_payment_labels?: string[];
  } | null;
  adjustment_ids: string[];
  created_at: string;
  concluded_at: string | null;
};

export type ItemRow = {
  id: string;
  attendance: string | null;
  tuss_code: string | null;
  procedure_date: string | null;
  patient_name: string | null;
  function_label: string | null;
  procedure_name: string | null;
  claimed_amount: number | null;
  claimed_quantity: number | null;
  paid_amount: number | null;
  paid_quantity: number | null;
  expected_amount: number | null;
  gap_amount: number | null;
  matched_payment_date: string | null;
  classification:
    | "ok_pago"
    | "pago_a_menos"
    | "pago_a_mais"
    | "nao_pago"
    | "pago_outro_mes"
    | "sem_lastro"
    | "tuss_divergente"
    | "pendente";
  classification_reason: string | null;
  payment_id: string | null;
};

export type DraftItem = {
  _localId: string;
  source: "form" | "upload" | "paste";
  attendance: string;
  tuss_code: string;
  procedure_date: string;
  patient_name: string;
  function_label: string;
  procedure_name: string;
  claimed_amount: string;
  claimed_quantity: string;
  /** Nome bruto da PJ vindo da planilha (quando a coluna foi mapeada). */
  company_hint?: string;
  /** id da PJ cadastrada resolvida no passo "Vincular PJs" do wizard. */
  resolved_company_id?: string | null;
};

// Rótulos do fluxo legado (ItemRow). Mantidos alinhados aos novos rótulos do TVR
// para não gerar duas nomenclaturas para o mesmo conceito na UI.
export const CLASS_LABEL: Record<ItemRow["classification"], string> = {
  ok_pago: "OK pago",
  pago_a_menos: "Pago a menos",
  pago_a_mais: "Pago a mais",
  nao_pago: "Faltou pagar",
  pago_outro_mes: "Pago em outro mês",
  sem_lastro: "Ausente base faturamento",
  tuss_divergente: "Pendência (TUSS faltante)",
  pendente: "Pendente",
};

export const CLASS_TONE: Record<ItemRow["classification"], string> = {
  ok_pago: "bg-emerald-100 text-emerald-800",
  pago_a_menos: "bg-amber-100 text-amber-800",
  pago_a_mais: "bg-rose-100 text-rose-800",
  nao_pago: "bg-red-100 text-red-800",
  pago_outro_mes: "bg-blue-100 text-blue-800",
  sem_lastro: "bg-zinc-100 text-zinc-800",
  tuss_divergente: "bg-purple-100 text-purple-800",
  pendente: "bg-zinc-100 text-zinc-800",
};
