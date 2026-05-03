import type { PaymentStatus } from "@/lib/status";

export type SlaSeverity = "informativo" | "alerta" | "critico";

export interface SlaSetting {
  id: string;
  status: PaymentStatus;
  business_days: number;
  warning_pct: number;
  severity: SlaSeverity;
  active: boolean;
}

export type DueRule = "dia_fixo" | "ultimo_dia_util_mes" | "dias_apos_fechamento" | "dias_apos_aprovacao";

export interface CompanySlaOverride {
  id: string;
  company_id: string;
  inherit_default: boolean;
  due_rule: DueRule;
  due_day: number | null;
  due_offset_days: number | null;
  priority: "alta" | "normal" | "baixa";
  notes: string | null;
}

export const DUE_RULE_LABELS: Record<DueRule, string> = {
  dia_fixo: "Dia fixo do mês",
  ultimo_dia_util_mes: "Último dia útil do mês",
  dias_apos_fechamento: "X dias após fechamento (competência)",
  dias_apos_aprovacao: "X dias após aprovação",
};

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Soma N dias úteis (ignora sábados/domingos). Não considera feriados. */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

/** Último dia útil do mês de uma data. */
export function lastBusinessDayOfMonth(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  while (isWeekend(d)) d.setDate(d.getDate() - 1);
  return d;
}

export type SlaLevel = "ok" | "preventivo" | "vencido";

export interface SlaEvaluation {
  level: SlaLevel;
  severity: SlaSeverity;
  dueAt: Date;
  enteredAt: Date;
  /** % do prazo já consumido. */
  pctElapsed: number;
  /** Dias úteis configurados. */
  budgetDays: number;
  source: "empresa" | "padrao" | "nenhum";
  reason: string;
}

export interface EvaluateInput {
  status: PaymentStatus;
  enteredAt: Date;
  competenceMonth?: string | null; // YYYY-MM-DD
  approvedAt?: Date | null;
  override?: CompanySlaOverride | null;
  defaultSettings?: SlaSetting | null;
  now?: Date;
}

/** Calcula vencimento do lote a partir das regras configuradas. */
export function evaluateSla(input: EvaluateInput): SlaEvaluation | null {
  const now = input.now ?? new Date();
  const setting = input.defaultSettings;
  const ov = input.override;

  let dueAt: Date | null = null;
  let source: SlaEvaluation["source"] = "nenhum";
  let reason = "";
  let budgetDays = setting?.business_days ?? 0;
  let warningPct = setting?.warning_pct ?? 80;
  let severity: SlaSeverity = setting?.severity ?? "alerta";

  // 1) Override da empresa
  if (ov && !ov.inherit_default) {
    source = "empresa";
    if (ov.due_rule === "dia_fixo" && ov.due_day) {
      const d = new Date(now.getFullYear(), now.getMonth(), ov.due_day);
      if (d < now) d.setMonth(d.getMonth() + 1);
      dueAt = d;
      reason = `Vencimento no dia ${ov.due_day} do mês`;
    } else if (ov.due_rule === "ultimo_dia_util_mes") {
      dueAt = lastBusinessDayOfMonth(now);
      reason = "Último dia útil do mês";
    } else if (ov.due_rule === "dias_apos_fechamento" && ov.due_offset_days != null && input.competenceMonth) {
      const [y, m] = input.competenceMonth.split("-").map(Number);
      const close = new Date(y, m, 0); // último dia do mês de competência
      dueAt = addBusinessDays(close, ov.due_offset_days);
      reason = `${ov.due_offset_days} dias úteis após fechamento`;
    } else if (ov.due_rule === "dias_apos_aprovacao" && ov.due_offset_days != null && input.approvedAt) {
      dueAt = addBusinessDays(input.approvedAt, ov.due_offset_days);
      reason = `${ov.due_offset_days} dias úteis após aprovação`;
    }
    budgetDays = ov.due_offset_days ?? budgetDays;
  }

  // 2) SLA padrão por status
  if (!dueAt && setting && setting.active) {
    source = "padrao";
    dueAt = addBusinessDays(input.enteredAt, setting.business_days);
    reason = `${setting.business_days} dias úteis no status`;
    budgetDays = setting.business_days;
    warningPct = setting.warning_pct;
    severity = setting.severity;
  }

  if (!dueAt) return null;

  const totalMs = dueAt.getTime() - input.enteredAt.getTime();
  const elapsedMs = now.getTime() - input.enteredAt.getTime();
  const pct = totalMs > 0 ? Math.max(0, Math.min(200, (elapsedMs / totalMs) * 100)) : 0;

  let level: SlaLevel = "ok";
  if (now > dueAt) level = "vencido";
  else if (pct >= warningPct) level = "preventivo";

  return { level, severity, dueAt, enteredAt: input.enteredAt, pctElapsed: pct, budgetDays, source, reason };
}

export const SLA_LEVEL_TONE: Record<SlaLevel, "ok" | "warning" | "destructive"> = {
  ok: "ok",
  preventivo: "warning",
  vencido: "destructive",
};