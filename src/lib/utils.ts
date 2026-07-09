import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const normalizeNumericValue = (v: unknown): { value: number; invalid: boolean } => {
  if (v == null || v === "") return { value: 0, invalid: false };
  if (typeof v === "number") {
    const invalid = isNaN(v) || v < 0;
    return { value: isNaN(v) ? 0 : v, invalid };
  }
  
  // Remove símbolos de moeda/espaços preservando separadores decimais.
  let s = String(v).replace(/[R$€£\s]/g, "").trim();
  if (!s) return { value: 0, invalid: false };
  // Placeholders contábeis de "zero" comuns em planilhas brasileiras: "-",
  // "--", "–", "—". Tratar como zero legítimo, não como valor inválido.
  if (/^[-–—]+$/.test(s)) return { value: 0, invalid: false };
  const cleaned = s.replace(/[^0-9,.-]/g, "");
  // Se após remover moeda/traços o original tinha caracteres numéricos ou não
  // sobrou nada legítimo: original "abc" → cleaned "" mas s tinha letras →
  // texto real → invalid. Já "R$ -" → s="-" cai no guard de traço acima.
  if (!cleaned) {
    if (/[a-z]/i.test(s)) return { value: 0, invalid: true };
    return { value: 0, invalid: false };
  }
  s = cleaned;
  if (/^-+$/.test(s)) return { value: 0, invalid: false };

  const isNegative = s.startsWith("-");
  if (isNegative) s = s.slice(1);

  const hasComma = s.includes(",");
  const hasPoint = s.includes(".");

  if (hasComma && hasPoint) {
    const lastComma = s.lastIndexOf(",");
    const lastPoint = s.lastIndexOf(".");
    
    if (lastComma > lastPoint) {
      // Format 1.234.567,89 -> 1234567.89
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Format 1,234,567.89 -> 1234567.89
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2) {
      // Multiple commas: 1,000,000 -> 1000000
      s = s.replace(/,/g, "");
    } else {
      // Em bases hospitalares brasileiras, vírgula isolada é decimal — inclusive
      // quando há 3+ casas por cálculo de acordo (ex.: "1.086,883125").
      s = s.replace(",", ".");
    }
  } else if (hasPoint) {
    const parts = s.split(".");
    if (parts.length > 2) {
      // Multiple points: 1.000.000 -> 1000000
      s = s.replace(/\./g, "");
    } else if (parts[1] && parts[1].length === 3) {
      // Single point followed by 3 digits: 1.000 -> 1000
      s = s.replace(/\./g, "");
    }
    // Else: 1.50 -> 1.50 (already correct for parseFloat)
  }

  const n = parseFloat(`${isNegative ? "-" : ""}${s}`);
  // Só texto realmente não-numérico ("abc") marca invalid. Zero e vazios já
  // foram tratados acima como zero legítimo.
  if (isNaN(n)) return { value: 0, invalid: true };
  return { value: n, invalid: n < 0 };
};

/**
 * Normaliza uma string para comparação: minúscula, sem acentos e sem espaços extras.
 */
export function normalizeString(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
