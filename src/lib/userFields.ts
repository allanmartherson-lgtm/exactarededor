import { z } from "zod";

// Brasil: DDD (2, 11–99) + 9 (celular) + 8 dígitos = 11 dígitos no total
const VALID_DDDS = new Set([
  11,12,13,14,15,16,17,18,19,
  21,22,24,27,28,
  31,32,33,34,35,37,38,
  41,42,43,44,45,46,47,48,49,
  51,53,54,55,
  61,62,63,64,65,66,67,68,69,
  71,73,74,75,77,79,
  81,82,83,84,85,86,87,88,89,
  91,92,93,94,95,96,97,98,99,
]);

const isValidBrazilianMobile = (v: string): boolean => {
  const d = v.replace(/\D/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) return false;
  if (d[2] !== "9") return false; // celular começa com 9 após o DDD
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais
  return true;
};

export const phoneSchema = z
  .string()
  .trim()
  .refine(isValidBrazilianMobile, {
    message: "Telefone inválido. Use DDD válido + 9 + 8 dígitos (ex.: (11) 99999-9999).",
  })
  .transform((v) => v.replace(/\D/g, ""));

export const formatPhone = (raw: string) => {
  const d = (raw ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// Data real (não 02/30), entre 1900-01-01 e hoje, idade mínima 14, máxima 120.
const isValidBirthDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) return false;
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (dt.getTime() > todayUTC) return false;
  const ageYears = (todayUTC - dt.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (ageYears < 14) return false;
  if (ageYears > 120) return false;
  return true;
};

export const birthDateSchema = z
  .string()
  .trim()
  .refine(isValidBirthDate, {
    message: "Data de nascimento inválida (use AAAA-MM-DD, idade entre 14 e 120 anos).",
  });

export const userExtraSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome completo").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: phoneSchema,
  role_title: z.string().trim().min(2, "Informe o cargo").max(80),
  department: z.string().trim().min(2, "Informe o setor").max(80),
  birth_date: birthDateSchema,
});

export type UserExtraFields = z.infer<typeof userExtraSchema>;
