import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Auditoria autônoma de sobreposição assistencial.
 * Consulta a RPC `get_overlap_audit` — não depende de a regra ter rodado
 * previamente no lote.
 */

export type OverlapItemScope = "both" | "visita" | "parecer";
export type SpecialtyMode = "primary" | "any";

export interface OverlapAuditParams {
  start: string;              // YYYY-MM-DD
  end: string;                // YYYY-MM-DD
  itemScope: OverlapItemScope;
  minDistinct: number;
  specialtyMode: SpecialtyMode;
  excludedSpecs: string[];    // normalizadas (lower, sem acento)
}

export interface OverlapComboRow {
  combo_label: string;
  combo_key: string;
  patients: number;
  days: number;
  attendances: number;
  items: number;
  sample_attendances: string[] | null;
  last_day: string | null;
}

export interface OverlapPatientRow {
  patient_key: string;
  patient_name: string;
  days: number;
  attendances: number;
  specialties: string[] | null;
  last_day: string | null;
}

export interface OverlapAttendanceRow {
  pdate: string;
  patient_name: string;
  attendances: string[] | null;
  doctors: string[] | null;
  specialties: string[] | null;
  payment_ids: string[] | null;
  total_gross: number | null;
  items: number;
}

export interface OverlapAuditResult {
  by_specialty_combo: OverlapComboRow[];
  by_patient: OverlapPatientRow[];
  by_attendance: OverlapAttendanceRow[];
  totals: { patients: number; days: number; attendances: number; items: number };
}

const EMPTY: OverlapAuditResult = {
  by_specialty_combo: [],
  by_patient: [],
  by_attendance: [],
  totals: { patients: 0, days: 0, attendances: 0, items: 0 },
};

export function useOverlapAudit() {
  return useMutation({
    mutationFn: async (params: OverlapAuditParams): Promise<OverlapAuditResult> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_overlap_audit", {
        p_start: params.start,
        p_end: params.end,
        p_item_scope: params.itemScope,
        p_min_distinct: params.minDistinct,
        p_specialty_mode: params.specialtyMode,
        p_excluded_specs: params.excludedSpecs,
      });
      if (error) {
        // Supabase devolve PostgrestError com { message, details, hint, code }.
        // Sem isso a UI cai em "[object Object]".
        const msg =
          (error as { message?: string })?.message ||
          (error as { details?: string })?.details ||
          "Erro desconhecido ao consultar auditoria.";
        const err = new Error(msg);
        (err as Error & { cause?: unknown }).cause = error;
        throw err;
      }
      if (!data) return EMPTY;
      return {
        by_specialty_combo: data.by_specialty_combo ?? [],
        by_patient: data.by_patient ?? [],
        by_attendance: data.by_attendance ?? [],
        totals: data.totals ?? EMPTY.totals,
      };
    },
  });
}
