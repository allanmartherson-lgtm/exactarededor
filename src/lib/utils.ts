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
  
  let s = String(v).replace(/[R$\s]/g, "");
  if (!s) return { value: 0, invalid: false };

  const hasComma = s.includes(",");
  const hasPoint = s.includes(".");

  if (hasComma && hasPoint) {
    // Caso 2: vírgula e ponto -> ponto milhar, vírgula decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Caso 3: apenas vírgula -> decimal
    s = s.replace(",", ".");
  } else if (hasPoint) {
    // Caso 4: apenas ponto -> verificar se milhar (3 dígitos) ou decimal
    const parts = s.split(".");
    const lastPart = parts[parts.length - 1];
    if (lastPart.length === 3) {
      s = s.replace(/\./g, "");
    }
  }

  const n = parseFloat(s);
  const invalid = isNaN(n) || n < 0;
  return { value: isNaN(n) ? 0 : n, invalid };
};
