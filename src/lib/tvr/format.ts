/**
 * Primitivas de parse e formatação de valores do TVR.
 *
 * `num` é a única porta de entrada para converter texto de planilha /
 * re-hidratação em número — testada em __tests__/num.test.ts.
 */

/**
 * Converte texto de planilha ou `String(number)` em número.
 *
 * Regras de separador (não regredir — ver __tests__/num.test.ts):
 *   - vírgula + ponto  → BR "1.234,56": ponto = milhar, vírgula = decimal
 *   - só vírgula       → decimal
 *   - só ponto:
 *       · múltiplos pontos → separador de milhar BR ("1.234.567" → 1234567)
 *       · um único ponto   → SEMPRE decimal
 */
export function num(v: string | number | undefined | null): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // BR "1.234,56": ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Múltiplos pontos = separador de milhar BR ("1.234.567" → 1234567).
    // Um único ponto: SEMPRE decimal. Não adivinhamos "900.025" como milhar
    // aqui: valores de planilha já vêm normalizados por parseCellMoney,
    // e valores de re-hidratação são sempre `String(number)` do JS
    // (ponto = decimal). O heurístico antigo (3 dígitos após o ponto = milhar)
    // inflacionava unit_tasy de 1800.05/2 = 900.025 em 1000×, produzindo
    // R$ 900.025,00 no lugar de R$ 900,03.
    const parts = s.split(".");
    if (parts.length > 2) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Detector de "escala suspeita" (ratio TASY/Pag) foi removido: o TASY vs
// Repasse compara valores já em Reais e um ratio alto é natural (100%
// convênio × repasse do médico). Erros de escala reais são evitados na
// leitura (parseCellMoney trata todo valor monetário como BRL) e ficam
// visíveis no wizard pela amostra da coluna.

export function brl(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Exibe data como DD-MM-YYYY, aceitando ISO ("YYYY-MM-DD") ou BR já formatado. */
export function formatTvrDate(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const br = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (br) return `${br[1]}-${br[2]}-${br[3]}`;
  return value;
}
