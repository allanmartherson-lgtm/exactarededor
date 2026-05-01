// Validação e formatação de CNPJ (algoritmo oficial — dígitos verificadores).
// Aceita string com máscara ou só dígitos. Rejeita 14 dígitos repetidos.

export const onlyDigits = (s: string): string => (s ?? "").replace(/\D+/g, "");

export const formatCNPJ = (raw: string): string => {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export const isValidCNPJ = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (base: string, weights: number[]): number => {
    const sum = base.split("").reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calc(d.slice(0, 12), w1);
  if (dv1 !== Number(d[12])) return false;
  const dv2 = calc(d.slice(0, 13), w2);
  return dv2 === Number(d[13]);
};