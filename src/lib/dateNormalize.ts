// Normalização de datas para gravação no banco (formato YYYY-MM-DD).
// Aceita os formatos que aparecem em planilhas TASY/Repasse:
//   - "YYYY-MM-DD" ou ISO com timestamp/timezone (ex: "2025-04-05T00:00:00.000Z")
//   - "DD/MM/YYYY" ou "DD-MM-YYYY" (formato BR)
//   - Objeto Date
//   - Serial de data do Excel (número puro, contagem a partir de 1899-12-30)

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normaliza qualquer entrada de data para "YYYY-MM-DD".
 * Retorna null quando o formato não é reconhecido OU dia/mês/ano são inválidos.
 * Nunca lança — usar em pipelines de importação onde entradas ruins devem virar `null`.
 */
export function dbDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    return isValidYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }

  const s = String(value).trim();
  if (!s) return null;

  // Serial Excel (ex: "45387"). Faixa razoável para evitar confundir com "20250405".
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 59 && serial < 80000) {
      const epoch = Date.UTC(1899, 11, 30);
      const dt = new Date(epoch + serial * 86400000);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      if (isValidYmd(y, m, d)) return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return isValidYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }

  const br = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    const y = Number(br[3]);
    return isValidYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }

  return null;
}
