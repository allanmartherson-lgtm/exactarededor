import { z } from "zod";

// Brasil: DDD (2) + 9 + 8 dígitos = 11 dígitos no total para celular
export const phoneSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{11}$/.test(v.replace(/\D/g, "")), {
    message: "Telefone inválido. Use DDD + 9 dígitos (11 números).",
  })
  .transform((v) => v.replace(/\D/g, ""));

export const formatPhone = (raw: string) => {
  const d = (raw ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const userExtraSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome completo").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: phoneSchema,
  role_title: z.string().trim().min(2, "Informe o cargo").max(80),
  department: z.string().trim().min(2, "Informe o setor").max(80),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
});

export type UserExtraFields = z.infer<typeof userExtraSchema>;
