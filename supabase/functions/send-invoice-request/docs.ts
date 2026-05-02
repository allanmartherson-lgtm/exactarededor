/**
 * Validação e formatação de CNPJ/CPF.
 *
 * Cópia local — edge functions Deno não enxergam código de src/.
 * Mantemos como arquivo dedicado para facilitar testes e reuso entre
 * funções da mesma família.
 */

export const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

export const formatCNPJ = (raw: string) => {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length !== 14) return raw ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export const formatCPF = (raw: string) => {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length !== 11) return raw ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

export const isValidCNPJ = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((a, c, i) => a + Number(c) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(d.slice(0, 12), w1) === Number(d[12]) && calc(d.slice(0, 13), w2) === Number(d[13]);
};

export const isValidCPF = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
};

export const formatDoc = (raw: string | null | undefined) => {
  const d = onlyDigits(raw ?? "");
  if (d.length === 14) return formatCNPJ(d);
  if (d.length === 11) return formatCPF(d);
  return raw ?? "—";
};

export type DocKind = "cnpj" | "cpf" | "indefinido";

export const validateDoc = (raw: string | null | undefined): { kind: DocKind; valid: boolean } => {
  const d = onlyDigits(raw ?? "");
  if (d.length === 14) return { kind: "cnpj", valid: isValidCNPJ(d) };
  if (d.length === 11) return { kind: "cpf", valid: isValidCPF(d) };
  return { kind: "indefinido", valid: false };
};
