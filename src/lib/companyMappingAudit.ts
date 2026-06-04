import { supabase } from "@/integrations/supabase/client";

export const normCompanyName = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

export type MappingDecision = "auto" | "manual" | "ignored" | "unmatched";

export interface LogMappingArgs {
  paymentId: string;
  reconciliationRunId?: string | null;
  hospitalCompanyRaw: string;
  exactaCompanyId: string | null; // null = ignorar / sem match
  decision: MappingDecision;
  reason?: string | null;
  changedBy?: string | null;
}

/**
 * Cria uma nova versão do vínculo hospital→Exacta. A trigger cuida de:
 *  - calcular version = max+1
 *  - marcar versões anteriores como is_current=false
 *  - preencher previous_exacta_company_id
 */
export async function logCompanyMapping(args: LogMappingArgs): Promise<{ error: unknown }> {
  const payload = {
    payment_id: args.paymentId,
    reconciliation_run_id: args.reconciliationRunId ?? null,
    hospital_company_raw: args.hospitalCompanyRaw,
    hospital_company_norm: normCompanyName(args.hospitalCompanyRaw),
    exacta_company_id: args.exactaCompanyId,
    decision: args.decision,
    reason: args.reason ?? null,
    changed_by: args.changedBy ?? null,
  };
  const { error } = await (supabase as any)
    .from("reconciliation_company_mappings")
    .insert(payload);
  return { error };
}

export interface MappingHistoryRow {
  id: string;
  payment_id: string;
  reconciliation_run_id: string | null;
  hospital_company_raw: string;
  hospital_company_norm: string;
  exacta_company_id: string | null;
  previous_exacta_company_id: string | null;
  decision: MappingDecision;
  reason: string | null;
  version: number;
  is_current: boolean;
  changed_by: string | null;
  changed_at: string;
}

export async function fetchMappingHistory(paymentId: string): Promise<MappingHistoryRow[]> {
  const { data, error } = await (supabase as any)
    .from("reconciliation_company_mappings")
    .select("*")
    .eq("payment_id", paymentId)
    .order("changed_at", { ascending: false });
  if (error) {
    console.warn("[companyMappingAudit] fetchMappingHistory error", error);
    return [];
  }
  return (data ?? []) as MappingHistoryRow[];
}
