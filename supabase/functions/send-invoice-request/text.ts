/**
 * Helpers de formatação textual em pt-BR para o pedido de NF:
 * - saudação dinâmica (Bom dia / Boa tarde / Boa noite) em horário de Brasília
 * - junção em lista natural ("A, B e C")
 * - dias úteis (soma/subtração)
 * - formatação de competência ("Janeiro de 2026")
 * - dinheiro em BRL
 */

export const fmtMoney = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const greetingBrasilia = (now = new Date()) => {
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return "Bom dia";
  if (brHour >= 12 && brHour < 18) return "Boa tarde";
  return "Boa noite";
};

export const joinPt = (arr: string[]) => {
  const a = arr.filter(Boolean);
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  return `${a.slice(0, -1).join(", ")} e ${a[a.length - 1]}`;
};

export const aoAos = (n: number) => (n > 1 ? "aos" : "ao");

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const formatCompetenceBR = (value: string | string[] | null | undefined): string => {
  if (!value) return "";
  const arr = Array.isArray(value) ? value : [value];
  const parts = arr
    .map((v) => /^(\d{4})-(\d{2})/.exec(v))
    .filter(Boolean)
    .map((m) => `${MONTH_NAMES[Number(m![2]) - 1]} de ${m![1]}`);
  return joinPt(Array.from(new Set(parts)));
};

export const addBusinessDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  let added = 0;
  const step = days >= 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setUTCDate(d.getUTCDate() + step);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) added++;
  }
  return d;
};

export const formatDateBR = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
