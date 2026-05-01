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
  cancelado: "Cancelado",
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
  cancelado: "muted",
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

export type RuleScope = Database["public"]["Enums"]["rule_scope"];
export type RuleSector = Database["public"]["Enums"]["rule_sector"];
export type RuleTargetType = Database["public"]["Enums"]["rule_target_type"];
export type RuleType = Database["public"]["Enums"]["rule_type"];

export const RULE_SCOPE_LABELS: Record<RuleScope, string> = {
  master: "Master (geral)",
  especifica: "Específica",
};

export const RULE_SECTOR_LABELS: Record<RuleSector, string> = {
  cirurgia: "Cirurgia",
  hemodinamica: "Hemodinâmica",
  parecer: "Parecer",
  visita: "Visita",
  procedimento: "Procedimento",
  consulta: "Consulta",
  outro: "Outro",
};

export const RULE_TARGET_TYPE_LABELS: Record<RuleTargetType, string> = {
  medico: "Médico",
  empresa: "Empresa",
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  informativo: "Informativa / bloqueio",
  pacote: "Pacote (valor fixo)",
  tabela_diferenciada: "Tabela diferenciada",
  bonus: "Bônus",
  complemento: "Complemento",
};

export const RULE_TYPE_DESCRIPTIONS: Record<RuleType, string> = {
  informativo: "Apenas alerta/bloqueia o validador, não calcula valor esperado.",
  pacote: "Valor fixo para a cirurgia/procedimento toda.",
  tabela_diferenciada: "Referência (ex: CBHPM 2018) × multiplicador − deflator.",
  bonus: "Honorário do convênio + um valor ou % adicional.",
  complemento: "Completa o que faltou para chegar ao valor acordado.",
};

export const formatCurrency = (value: number | string | null | undefined) => {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
};

export const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
};

export type PaymentType = Database["public"]["Enums"]["payment_type"];
export type PaymentKind = Database["public"]["Enums"]["payment_kind"];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  producao: "Produção",
  repasse: "Repasse",
  valor_fixo: "Valor fixo",
  plantao: "Plantão",
  misto: "Misto",
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  atual: "Pagamento atual",
  pendencia: "Pendência",
  misto: "Misto (atual + pendência)",
};

export const formatCompetence = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(d);
};

export const formatDateOnly = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
};