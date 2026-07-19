// Feriados nacionais brasileiros — usado apenas para sinalização visual
// no grid de itens. Detecção conservadora: apenas feriados nacionais fixos
// + Páscoa/Carnaval/Corpus Christi calculados dinamicamente. Feriados
// estaduais/municipais não entram aqui para evitar falsos positivos.

/** Calcula o domingo de Páscoa via algoritmo de Meeus/Jones/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

const cache = new Map<number, Record<string, string>>();

function holidaysFor(year: number): Record<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = easterSunday(year);
  const carnavalTerca = addDays(easter, -47);
  const carnavalSegunda = addDays(easter, -48);
  const sextaSanta = addDays(easter, -2);
  const corpusChristi = addDays(easter, 60);
  const map: Record<string, string> = {
    [`${year}-01-01`]: "Confraternização Universal",
    [fmt(carnavalSegunda)]: "Carnaval (segunda)",
    [fmt(carnavalTerca)]: "Carnaval (terça)",
    [fmt(sextaSanta)]: "Sexta-feira Santa",
    [`${year}-04-21`]: "Tiradentes",
    [`${year}-05-01`]: "Dia do Trabalho",
    [fmt(corpusChristi)]: "Corpus Christi",
    [`${year}-09-07`]: "Independência",
    [`${year}-10-12`]: "N. S. Aparecida",
    [`${year}-11-02`]: "Finados",
    [`${year}-11-15`]: "Proclamação da República",
    [`${year}-11-20`]: "Consciência Negra",
    [`${year}-12-25`]: "Natal",
  };
  cache.set(year, map);
  return map;
}

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const WEEKDAYS_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export type DayContext = {
  weekdayShort: string;
  weekdayLong: string;
  isWeekend: boolean;
  holidayName: string | null;
};

/** Extrai contexto do dia a partir de uma data ISO (yyyy-mm-dd) ou datetime. */
export function getDayContext(dateInput: string | null | undefined): DayContext | null {
  if (!dateInput) return null;
  const iso = String(dateInput).slice(0, 10);
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  // Interpretamos como data local (sem fuso) para bater com procedure_date.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  const map = holidaysFor(y);
  return {
    weekdayShort: WEEKDAYS_SHORT[dow],
    weekdayLong: WEEKDAYS_LONG[dow],
    isWeekend: dow === 0 || dow === 6,
    holidayName: map[iso] ?? null,
  };
}
