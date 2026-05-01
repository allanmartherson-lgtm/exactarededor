import type { Database } from "@/integrations/supabase/types";

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type AppRole = Database["public"]["Enums"]["app_role"];
export type ItemAiStatus = Database["public"]["Enums"]["item_ai_status"];
export type RuleSeverity = Database["public"]["Enums"]["rule_severity"];
export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  rascunho: "Rascunho",
  em_analise_ia: "Em análise por IA",
  aguardando_validacao: "Aguardando validação",
  devolvido_analista: "Devolvido ao analista",
  aguardando_aprovacao: "Aguardando aprovação",
  devolvido_validador: "Devolvido ao validador",
  aprovado: "Aprovado",
  pedido_nf_enviado: "Pedido de NF enviado",
  nf_recebida: "NF recebida",
  nf_conciliada: "NF conciliada",
  nf_divergente: "NF divergente",
  pago: "Pago",
  rejeitado: "Rejeitado",
};

type Tone = "info" | "success" | "warning" | "destructive" | "muted" | "primary";

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, Tone> = {
  rascunho: "muted",
  em_analise_ia: "info",
  aguardando_validacao: "warning",
  devolvido_analista: "destructive",
  aguardando_aprovacao: "warning",
  devolvido_validador: "destructive",
  aprovado: "success",
  pedido_nf_enviado: "info",
  nf_recebida: "info",
  nf_conciliada: "success",
  nf_divergente: "destructive",
  pago: "success",
  rejeitado: "destructive",
};

export const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-info-soft text-info border-info/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning-foreground border-warning/30",
  destructive: "bg-destructive-soft text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary-soft text-primary border-primary/20",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  diretor: "Diretor",
  validador: "Validador",
  analista: "Analista",
};

export const formatCurrency = (value: number | string | null | undefined) => {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
};

export const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
};