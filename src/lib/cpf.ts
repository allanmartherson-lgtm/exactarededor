// Validação e formatação de CPF (algoritmo oficial — dígitos verificadores).
// Aceita string com máscara ou só dígitos. Rejeita 11 dígitos repetidos.

export const onlyDigits = (s: string): string => (s ?? "").replace(/\D+/g, "");

export const formatCPF = (raw: string): string => {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

export const isValidCPF = (raw: string | null | undefined): boolean => {
  const d = onlyDigits(raw ?? "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, factor: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const dv1 = calc(d.slice(0, 9), 10);
  if (dv1 !== Number(d[9])) return false;
  const dv2 = calc(d.slice(0, 10), 11);
  return dv2 === Number(d[10]);
};
