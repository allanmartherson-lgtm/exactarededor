/**
 * SLA de comunicação em horas úteis (08–18 seg–sex).
 * Não cobre feriados — pode ser estendido depois com brHolidays.
 */
export type CommChannel = "doctor" | "company_payment" | "company_invoice";
export type CommSlaLevel = "ok" | "preventivo" | "vencido";

const WORK_START = 8;
const WORK_END = 18;
const HOURS_PER_DAY = WORK_END - WORK_START;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Soma N horas úteis a uma data. */
export function addBusinessHours(start: Date, hours: number): Date {
  const d = new Date(start);
  let remaining = hours;
  // normaliza para dentro da janela útil
  while (isWeekend(d) || d.getHours() < WORK_START || d.getHours() >= WORK_END) {
    if (isWeekend(d) || d.getHours() >= WORK_END) {
      d.setDate(d.getDate() + (isWeekend(d) ? 1 : 1));
      d.setHours(WORK_START, 0, 0, 0);
      if (isWeekend(d)) continue;
    } else if (d.getHours() < WORK_START) {
      d.setHours(WORK_START, 0, 0, 0);
    }
  }
  while (remaining > 0) {
    const endOfDay = new Date(d);
    endOfDay.setHours(WORK_END, 0, 0, 0);
    const availableMs = endOfDay.getTime() - d.getTime();
    const neededMs = remaining * 3600_000;
    if (neededMs <= availableMs) {
      d.setTime(d.getTime() + neededMs);
      remaining = 0;
    } else {
      remaining -= availableMs / 3600_000;
      d.setDate(d.getDate() + 1);
      d.setHours(WORK_START, 0, 0, 0);
      while (isWeekend(d)) d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

/** Diferença em horas úteis entre `from` e `to`. */
export function diffBusinessHours(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    if (!isWeekend(cursor)) {
      const dayStart = new Date(cursor); dayStart.setHours(WORK_START, 0, 0, 0);
      const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END, 0, 0, 0);
      const lo = cursor < dayStart ? dayStart : cursor;
      const hi = to < dayEnd ? to : dayEnd;
      if (hi > lo) total += (hi.getTime() - lo.getTime()) / 3600_000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(WORK_START, 0, 0, 0);
  }
  return Math.max(0, total);
}

export interface CommSlaSetting {
  channel: CommChannel;
  first_response_hours: number;
  resolution_hours: number;
  warning_pct: number;
  active: boolean;
}

export interface CommSlaEval {
  level: CommSlaLevel;
  dueAt: Date;
  hoursElapsed: number;
  pct: number;
  budgetHours: number;
}

/**
 * Avalia SLA da thread. Se já houve primeira resposta, usa resolution_hours;
 * caso contrário, usa first_response_hours.
 */
export function evaluateCommSla(input: {
  openedAt: Date;
  firstResponseAt?: Date | null;
  setting: CommSlaSetting;
  now?: Date;
}): CommSlaEval {
  const now = input.now ?? new Date();
  const budgetHours = input.firstResponseAt
    ? input.setting.resolution_hours
    : input.setting.first_response_hours;
  const dueAt = addBusinessHours(input.openedAt, budgetHours);
  const elapsed = diffBusinessHours(input.openedAt, now);
  const pct = budgetHours > 0 ? (elapsed / budgetHours) * 100 : 0;
  let level: CommSlaLevel = "ok";
  if (now > dueAt) level = "vencido";
  else if (pct >= input.setting.warning_pct) level = "preventivo";
  return { level, dueAt, hoursElapsed: elapsed, pct, budgetHours };
}

export const CHANNEL_LABEL: Record<CommChannel, string> = {
  doctor: "Médico",
  company_payment: "Empresa · Lote",
  company_invoice: "Empresa · NF",
};

export const SLA_LEVEL_BADGE: Record<CommSlaLevel, { label: string; tone: "ok" | "warning" | "destructive" }> = {
  ok: { label: "No prazo", tone: "ok" },
  preventivo: { label: "Atenção", tone: "warning" },
  vencido: { label: "Vencido", tone: "destructive" },
};
