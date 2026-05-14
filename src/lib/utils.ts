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
  
  // Remove currency symbols, spaces, and other non-numeric chars except , and .
  let s = String(v).replace(/[R$€£\s]/g, "").trim();
  if (!s) return { value: 0, invalid: false };

  // Handle common formats:
  // 1.234,56 (European/Brazilian)
  // 1,234.56 (US/UK)
  // 1.234 (Could be 1234 or 1.234)
  // 1,234 (Could be 1234 or 1.234)

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
    // Check if it's a thousand separator (e.g., 1.000) or decimal (e.g., 1,50)
    // If there's only one comma and it's followed by 3 digits, it MIGHT be a thousand separator,
    // but in Brazil/Europe it's almost always a decimal.
    // Heuristic: if it's "X,YY" it's decimal. If it's "X,YYY" it's likely thousand.
    const parts = s.split(",");
    if (parts.length > 2) {
      // Multiple commas: 1,000,000 -> 1000000
      s = s.replace(/,/g, "");
    } else if (parts[1] && parts[1].length === 3) {
      // Single comma followed by exactly 3 digits: could be 1,000. 
      // But 1,000 is also a valid decimal. 
      // Most spreadsheets use . for thousand and , for decimal in BR.
      // If we only have comma, we assume it's a decimal unless it looks like 1,000,000
      s = s.replace(",", ".");
    } else {
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

  const n = parseFloat(s);
  const invalid = isNaN(n) || n < 0;
  return { value: isNaN(n) ? 0 : n, invalid };
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
