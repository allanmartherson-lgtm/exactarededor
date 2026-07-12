/**
 * Log de auditoria para eventos de aplicação de deduções.
 * Cada tentativa (aplicada, deduplicada, lote alterado, erro) é gravada
 * em `deduction_application_events` com o usuário responsável.
 */
import { supabase } from "@/integrations/supabase/client";

export type DeductionEventAction =
  | "applied"
  | "skipped_duplicate"
  | "target_updated"
  | "error"
  | "no_pending"
  | "no_target_selected";

export interface LogDeductionEventInput {
  hospital_id?: string | null;
  payment_id?: string | null;
  company_id?: string | null;
  debt_id?: string | null;
  action: DeductionEventAction;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

let cachedUser: { id: string; email: string | null } | null = null;

async function getUser() {
  if (cachedUser) return cachedUser;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  cachedUser = { id: data.user.id, email: data.user.email ?? null };
  return cachedUser;
}

export async function logDeductionEvent(evt: LogDeductionEventInput): Promise<void> {
  try {
    const user = await getUser();
    if (!user) return;
    await (supabase as any).from("deduction_application_events").insert({
      hospital_id: evt.hospital_id ?? null,
      user_id: user.id,
      user_email: user.email,
      payment_id: evt.payment_id ?? null,
      company_id: evt.company_id ?? null,
      debt_id: evt.debt_id ?? null,
      action: evt.action,
      reason: evt.reason ?? null,
      metadata: evt.metadata ?? {},
    });
  } catch (err) {
    console.warn("[logDeductionEvent] falha ao registrar auditoria:", err);
  }
}

export async function logDeductionEvents(evts: LogDeductionEventInput[]): Promise<void> {
  if (!evts.length) return;
  try {
    const user = await getUser();
    if (!user) return;
    const rows = evts.map(evt => ({
      hospital_id: evt.hospital_id ?? null,
      user_id: user.id,
      user_email: user.email,
      payment_id: evt.payment_id ?? null,
      company_id: evt.company_id ?? null,
      debt_id: evt.debt_id ?? null,
      action: evt.action,
      reason: evt.reason ?? null,
      metadata: evt.metadata ?? {},
    }));
    await (supabase as any).from("deduction_application_events").insert(rows);
  } catch (err) {
    console.warn("[logDeductionEvents] falha ao registrar auditoria:", err);
  }
}

export interface DeductionEventRow {
  id: string;
  hospital_id: string | null;
  user_id: string | null;
  user_email: string | null;
  payment_id: string | null;
  company_id: string | null;
  debt_id: string | null;
  action: DeductionEventAction;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FetchDeductionEventsFilter {
  hospital_id?: string | null;
  company_id?: string | null;
  debt_id?: string | null;
  payment_id?: string | null;
  limit?: number;
}

export async function fetchDeductionEvents(filter: FetchDeductionEventsFilter): Promise<DeductionEventRow[]> {
  let q = (supabase as any).from("deduction_application_events").select("*").order("created_at", { ascending: false });
  if (filter.hospital_id) q = q.eq("hospital_id", filter.hospital_id);
  if (filter.company_id) q = q.eq("company_id", filter.company_id);
  if (filter.debt_id) q = q.eq("debt_id", filter.debt_id);
  if (filter.payment_id) q = q.eq("payment_id", filter.payment_id);
  q = q.limit(filter.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DeductionEventRow[];
}

export const ACTION_LABEL: Record<DeductionEventAction, string> = {
  applied: "Aplicado",
  skipped_duplicate: "Ignorado (duplicado)",
  target_updated: "Lote-alvo alterado",
  error: "Erro",
  no_pending: "Nada pendente",
  no_target_selected: "Sem lote escolhido",
};

export const ACTION_TONE: Record<DeductionEventAction, "success" | "muted" | "info" | "destructive" | "warning"> = {
  applied: "success",
  skipped_duplicate: "muted",
  target_updated: "info",
  error: "destructive",
  no_pending: "muted",
  no_target_selected: "warning",
};
