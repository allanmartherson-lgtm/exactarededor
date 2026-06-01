/**
 * Feriados nacionais brasileiros — usado pelo motor de regras de bônus
 * para tratar feriados como equivalentes a fim de semana quando o cálculo
 * marca `includes_holidays = true`.
 *
 * Cobre apenas os feriados NACIONAIS (Lei 662/1949, Lei 6.802/1980 e
 * Lei 10.607/2002) + os pontos facultativos federais consagrados
 * (Carnaval — segunda e terça — e Quarta-feira de Cinzas até 12h).
 * Feriados estaduais/municipais NÃO entram aqui porque variam por unidade
 * e dependem de cadastro da empresa.
 *
 * Datas móveis (Carnaval, Sexta-feira Santa, Corpus Christi) são derivadas
 * da Páscoa via algoritmo de Meeus/Jones/Butcher (Gregoriano).
 *
 * IMPORTANTE: usamos parsing em UTC para evitar deslocamento de fuso —
 * `new Date("2026-04-21")` é interpretado como UTC, mas `getDay()` retorna
 * em local-tz, o que em servidores fora de BRT pode trocar o dia. A solução
 * aqui é comparar SEMPRE ano/mês/dia em UTC com a tabela de feriados.
 */

function easterSunday(year: number): { month: number; day: number } {
  // Meeus/Jones/Butcher Gregorian Easter algorithm.
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Soma `days` dias a uma data {month,day} de um ano específico, em UTC. */
function addDays(year: number, month: number, day: number, days: number): { month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  return { month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

/** Lista de feriados nacionais (mês/dia) para um ano. */
function holidaysForYear(year: number): Set<string> {
  const easter = easterSunday(year);

  // Móveis a partir da Páscoa
  const carnavalSeg = addDays(year, easter.month, easter.day, -48);
  const carnavalTer = addDays(year, easter.month, easter.day, -47);
  const cinzas = addDays(year, easter.month, easter.day, -46); // ponto facultativo
  const sextaSanta = addDays(year, easter.month, easter.day, -2);
  const corpusChristi = addDays(year, easter.month, easter.day, 60);

  const fixed: Array<[number, number]> = [
    [1, 1],   // Confraternização Universal
    [4, 21],  // Tiradentes
    [5, 1],   // Dia do Trabalho
    [9, 7],   // Independência
    [10, 12], // Nossa Senhora Aparecida
    [11, 2],  // Finados
    [11, 15], // Proclamação da República
    [11, 20], // Consciência Negra (federal desde 2024 — Lei 14.759/2023)
    [12, 25], // Natal
  ];

  const set = new Set<string>();
  for (const [m, d] of fixed) set.add(`${m}-${d}`);
  set.add(`${carnavalSeg.month}-${carnavalSeg.day}`);
  set.add(`${carnavalTer.month}-${carnavalTer.day}`);
  set.add(`${cinzas.month}-${cinzas.day}`);
  set.add(`${sextaSanta.month}-${sextaSanta.day}`);
  set.add(`${corpusChristi.month}-${corpusChristi.day}`);
  return set;
}

// Cache por ano — feriados não mudam ao longo de um run.
const yearCache = new Map<number, Set<string>>();
function getHolidaySet(year: number): Set<string> {
  let s = yearCache.get(year);
  if (!s) { s = holidaysForYear(year); yearCache.set(year, s); }
  return s;
}

/**
 * Parser robusto que evita deslocamento de fuso. Aceita:
 *  - 'YYYY-MM-DD' (date-only) → interpretado como meio-dia local para fixar o dia
 *  - 'YYYY-MM-DDTHH:MM[:SS]' (ISO com hora) → respeita a hora local registrada
 *  - 'DD/MM/YYYY' (formato BR)
 *  - Date instance
 * Retorna `{year, month, day}` em base local (que é o que o usuário enxerga).
 */
function parseDateParts(input: string | Date): { year: number; month: number; day: number } | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return { year: input.getFullYear(), month: input.getMonth() + 1, day: input.getDate() };
  }
  const s = String(input || "").trim();
  if (!s) return null;

  // DD/MM/YYYY
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    let y = parseInt(br[3], 10);
    if (y < 100) y += 2000;
    return { year: y, month: parseInt(br[2], 10), day: parseInt(br[1], 10) };
  }

  // YYYY-MM-DD com ou sem hora
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    return { year: +iso[1], month: +iso[2], day: +iso[3] };
  }

  // Último recurso — Date(...) pode trocar dia em UTC, mas é melhor que falhar.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Verifica se a data informada é um feriado nacional brasileiro. */
export function isBrazilianNationalHoliday(input: string | Date): boolean {
  const parts = parseDateParts(input);
  if (!parts) return false;
  return getHolidaySet(parts.year).has(`${parts.month}-${parts.day}`);
}

// Exposto para testes
export const __test = { easterSunday, holidaysForYear, parseDateParts };
