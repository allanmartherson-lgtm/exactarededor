/**
 * Resolve gross_amount e procedure_amount de uma linha de planilha aplicando
 * a regra de precedência:
 *  - Coluna mapeada pelo analista OU coluna canônica encontrada → AUTORITATIVA
 *    (inclui valor 0 — ex.: regra de não-pagamento Sul América).
 *  - Heurística genérica ("Valor"/"Valor Tot") só entra como fallback quando
 *    nenhuma das duas existe.
 *
 * Extraído de mapJsonToRows para permitir testes unitários puros.
 */
import { applyManualMappingShim, type ManualMapping } from "@/lib/columnMapping";
import { normalizeNumericValue } from "@/lib/utils";

export const REPASSE_ALIASES = [
  "vl repasse", "valor repasse", "valor a repassar", "valor repassar",
  "vlrepasse", "vl. repasse",
];

export const PROC_AMOUNT_ALIASES = [
  "valor procedimento", "valor proce", "vl proce", "vlproce",
  "valor convenio", "valor convênio", "vl convenio", "vl. convenio",
];

export const GROSS_FALLBACK_ALIASES = ["valor bruto", "vlrbruto", "bruto", "valor"];
export const GROSS_FALLBACK_EXCLUDES = ["repasse"];

const norm = (s: string): string =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./]+/g, "");

/**
 * Mesma lógica do `pick` interno do NewPayment.tsx, duplicada aqui para
 * manter este módulo standalone (sem dependência da página). Mantenha em
 * sincronia: se o pick principal mudar, atualize aqui também.
 */
export const pick = (
  row: Record<string, unknown>,
  keys: string[],
  excludes: string[] = [],
): unknown => {
  const headers = Object.keys(row);
  const nExcludes = excludes.map(norm).filter(Boolean);
  let bestKey: string | null = null;
  let bestScore = 0;
  headers.forEach((rk) => {
    const nrk = norm(rk);
    if (!nrk) return;
    if (nExcludes.some((ex) => nrk.includes(ex))) return;
    let score = 0;
    keys.forEach((k, idx) => {
      const nk = norm(k);
      if (!nk) return;
      let s = 0;
      if (nrk === nk) s = 100;
      else if (nrk.startsWith(nk)) s = 60;
      else if (nrk.includes(nk)) s = 30;
      if (s === 0) return;
      s += Math.max(0, 10 - idx);
      if (s > score) score = s;
    });
    if (score > bestScore) {
      bestScore = score;
      bestKey = rk;
    }
  });
  return bestKey != null ? row[bestKey] : undefined;
};

export type ResolvedAmounts = {
  gross_amount: number;
  procedure_amount: number | null;
  valor_invalido: boolean;
  grossAuthoritative: boolean;
  procAuthoritative: boolean;
};

export const resolvePaymentAmounts = (
  rawRow: Record<string, unknown>,
  manualMapping?: ManualMapping,
): ResolvedAmounts => {
  const row = applyManualMappingShim(rawRow, manualMapping);
  const grossMappedByAnalyst = !!manualMapping?.gross_amount;
  const procMappedByAnalyst = !!manualMapping?.procedure_amount;

  const repasseRaw = pick(row, REPASSE_ALIASES);
  const repasseFound = repasseRaw !== undefined;
  const r_repasse = normalizeNumericValue(repasseRaw);

  const procValRaw = pick(row, PROC_AMOUNT_ALIASES);
  const procValFound = procValRaw !== undefined;
  const r_procVal = normalizeNumericValue(procValRaw);

  const grossAuthoritative = grossMappedByAnalyst || repasseFound;
  const r_gross = grossAuthoritative
    ? { value: 0, invalid: false }
    : normalizeNumericValue(pick(row, GROSS_FALLBACK_ALIASES, GROSS_FALLBACK_EXCLUDES));

  const repasse = r_repasse.value;
  const procVal = r_procVal.value;

  const gross_amount = grossAuthoritative
    ? repasse
    : (repasse || r_gross.value || procVal);

  const procAuthoritative = procMappedByAnalyst || procValFound;
  const procedure_amount = procAuthoritative
    ? procVal
    : (procVal || gross_amount || null);

  const valor_invalido = r_repasse.invalid || r_procVal.invalid || r_gross.invalid;

  return {
    gross_amount,
    procedure_amount,
    valor_invalido,
    grossAuthoritative,
    procAuthoritative,
  };
};
