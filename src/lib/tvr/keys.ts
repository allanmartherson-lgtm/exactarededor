/**
 * Normalizações e composição da chave canônica de cruzamento TASY × Repasse.
 *
 * A chave é: Atendimento + Data (Y-M-D) + TUSS (8 dígitos) + Médico
 * (doctor_id quando disponível, nome normalizado como fallback).
 */

export function normTuss(v: string | undefined): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 8);
}

export function tvrTussKey(v: string | undefined): string {
  // Chave TUSS estrita em 8 dígitos (usuário confirmou uso da coluna 8d).
  // Se vier com menos dígitos, mantém o que houver — nunca "encurta" para 7.
  return normTuss(v);
}

export function isExcludedTvrTuss(v: string | undefined, excluded: Set<string>): boolean {
  const full = normTuss(v);
  if (!full) return false;
  return excluded.has(full);
}

export function normAtt(v: string | undefined): string {
  return String(v ?? "").trim();
}

// Normaliza nome do médico: remove acentos, prefixos ("dr", "dra"), pontuação e
// colapsa espaços. Usada só como fallback quando não há doctor_id do lado TASY.
export function normDoctorName(v: string | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bdr[a]?\.?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Prefere doctor_id (confiável). Cai para nome normalizado quando id ausente.
// `nameToId` é um índice compartilhado (construído a partir do lado Repasse) que
// permite ao lado TASY também "cair" em `d:<id>` quando o nome bate.
function doctorKeyPart(id: string | undefined, name: string | undefined, nameToId?: Map<string, string>): string {
  const did = (id ?? "").trim();
  if (did) return `d:${did}`;
  const n = normDoctorName(name);
  if (!n) return "";
  const mapped = nameToId?.get(n);
  if (mapped) return `d:${mapped}`;
  return `n:${n}`;
}

// Extrai Y-M-D puro sem passar por fuso. Aceita "YYYY-MM-DD[Thh:mm...]" ou
// "DD/MM/YYYY". Retorna "" quando não conseguir identificar.
export function dateKeyPart(v: string | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}

// Compõe a chave canônica de cruzamento TASY×Repasse.
// Atendimento + Data (Y-M-D) + TUSS (8d) + Médico (doctor_id ou nome normalizado).
export function tvrMatchKey(att: string | undefined, date: string | undefined, tuss: string | undefined, doctorId: string | undefined, doctorName: string | undefined, nameToId?: Map<string, string>): string {
  return `${normAtt(att)}|${dateKeyPart(date)}|${tvrTussKey(tuss)}|${doctorKeyPart(doctorId, doctorName, nameToId)}`;
}

export function isYmdWithinInclusive(value: string | null, start: string, end: string): boolean {
  if (!value) return false;
  return value >= start.slice(0, 10) && value <= end.slice(0, 10);
}
