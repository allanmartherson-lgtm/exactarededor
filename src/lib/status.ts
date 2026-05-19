import type { Database } from "@/integrations/supabase/types";

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type AppRole = Database["public"]["Enums"]["app_role"];
export type ItemAiStatus = Database["public"]["Enums"]["item_ai_status"];
export type RuleSeverity = Database["public"]["Enums"]["rule_severity"];
export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  rascunho: "Rascunho",
  em_analise_ia: "Em análise por IA",
  revisao_analista: "Em revisão pelo analista",
  concluida_analista: "Concluída pelo analista",
  aguardando_validacao: "Aguardando validação",
  devolvido_analista: "Devolvido ao analista",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado_em_revisao: "Aprovado (em revisão)",
  aprovado: "Aprovado",
  aprovado_com_ressalva: "Aprovado com ressalva",
  pedido_nf_enviado: "Pedido de NF enviado",
  nf_questionada: "NF questionada",
  nf_recebida: "NF recebida",
  nf_conciliada: "NF conciliada",
  lancado: "Lançado",
  arquivado: "Arquivado",
  nf_divergente: "NF divergente",
  pago: "Pago",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  em_questionamento: "Em questionamento",
  aprovado_parcial: "Aprovado parcial",
  revisao_pos_aprovacao: "Aguardando revisão de NF",
};

type Tone = "info" | "success" | "warning" | "destructive" | "muted" | "primary";

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, Tone> = {
  rascunho: "muted",
  em_analise_ia: "info",
  revisao_analista: "primary",
  concluida_analista: "success",
  aguardando_validacao: "warning",
  devolvido_analista: "destructive",
  aguardando_aprovacao: "warning",
  aprovado_em_revisao: "primary",
  aprovado: "success",
  aprovado_com_ressalva: "warning",
  pedido_nf_enviado: "info",
  nf_questionada: "destructive",
  nf_recebida: "info",
  nf_conciliada: "success",
  lancado: "primary",
  arquivado: "muted",
  nf_divergente: "destructive",
  pago: "success",
  rejeitado: "destructive",
  cancelado: "muted",
  em_questionamento: "warning",
  aprovado_parcial: "warning",
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
export type RuleCalculationType = Database["public"]["Enums"]["rule_calculation_type"];
export type PaymentAnalysisMode = Database["public"]["Enums"]["payment_analysis_mode"];

export const RULE_SCOPE_LABELS: Record<RuleScope, string> = {
  master: "Master (geral)",
  especifica: "Específica",
  grupo: "Grupo de médicos/empresas",
};

export const RULE_SECTOR_LABELS: Record<RuleSector, string> = {
  cirurgia: "Centro Cirúrgico",
  hemodinamica: "Hemodinâmica",
  sadt_endoscopia: "SADT Endoscopia",
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

// RULE_TYPE_LABELS / RULE_TYPE_DESCRIPTIONS removidos — natureza/método agora vivem
// somente em RULE_CALCULATION_TYPE_* (motor novo).

// === Novo motor determinístico (Fase 2/3) ===
export const RULE_CALCULATION_TYPE_LABELS: Record<RuleCalculationType, string> = {
  percentual_sobre_convenio: "Percentual sobre convênio",
  regra_vias: "Regra de vias (acesso)",
  pacote_fechado: "Pacote fechado",
  pacote_com_extras: "Pacote com extras",
  pacote_por_atendimento: "Pacote por atendimento",
  pacote: "Pacote",
  valor_fixo: "Valor fixo",
  tabela_diferenciada: "Tabela diferenciada",
  bonus: "Bônus",
  complemento: "Complemento",
  exclusao: "Exclusão (não pagar)",
  informativo: "Informativo",
};
export const RULE_CALCULATION_TYPE_DESCRIPTIONS: Record<RuleCalculationType, string> = {
  percentual_sobre_convenio: "Esperado = X% do valor pago pelo convênio (ex.: 100, 88, 70).",
  regra_vias: "Aplica fator pela via de acesso: principal/única=100%, mesma via=50%, diferente=70%.",
  pacote_fechado: "Valor único fixo para todo o pacote/procedimento.",
  pacote_com_extras: "Valor de pacote + lista de códigos pagos à parte (100% do convênio).",
  pacote_por_atendimento: "Aplica o pacote uma única vez por atendimento; demais itens do mesmo atendimento ficam embutidos no pacote.",
  pacote: "Aplica o pacote uma única vez por atendimento. Subtipos: Fechado (qualquer item fora gera alerta) ou Com extras (visitas, pareceres, auxiliares e códigos extras permitidos).",
  valor_fixo: "Esperado = valor cravado, independente do convênio.",
  tabela_diferenciada: "Usa uma tabela de referência (ex.: CBHPM) com multiplicador, deflator e % de repasse.",
  bonus: "Honorário do convênio + valor ou % adicional.",
  complemento: "Completa o que faltou para chegar ao valor acordado.",
  exclusao: "Item não deve ser pago — esperado = R$ 0 e gera alerta.",
  informativo: "Não calcula esperado, só sinaliza/bloqueia o validador.",
};

export const PAYMENT_ANALYSIS_MODE_LABELS: Record<PaymentAnalysisMode, string> = {
  padrao: "Padrão (com histórico)",
  isolado: "Isolado (sem histórico)",
  empresa_prioritaria: "Empresa prioritária (isolado)",
};
export const PAYMENT_ANALYSIS_MODE_DESCRIPTIONS: Record<PaymentAnalysisMode, string> = {
  padrao: "Análise considera observações de outros pagamentos como contexto.",
  isolado: "Cada pagamento é analisado por si só, sem buscar contexto histórico de outros lotes.",
  empresa_prioritaria: "Cada arquivo é analisado isoladamente; só itens com erro aparecem no detalhe.",
};

// Prioridade da regra escolhida pelo motor determinístico (Fase 2/3)
export type RuleMatchPriority =
  | "convenio_especialidade_codigo"
  | "convenio_especialidade"
  | "convenio_codigo"
  | "convenio"
  | "medico_codigo"
  | "medico"
  | "empresa_codigo"
  | "empresa"
  | "grupo_codigo"
  | "grupo"
  | "setor_codigo"
  | "setor"
  | "setor_outro"
  | "setor_hemodinamica_master"
  | "setor_master_geral"
  | "default_setor"
  | "sem_regra"
  | "conflito";

export const RULE_MATCH_PRIORITY_LABELS: Record<RuleMatchPriority, string> = {
  convenio_especialidade_codigo: "Convênio + Especialidade + Código",
  convenio_especialidade: "Convênio + Especialidade",
  convenio_codigo: "Convênio + Código",
  convenio: "Convênio",
  medico_codigo: "Médico + Código",
  medico: "Médico",
  empresa_codigo: "Empresa + Código",
  empresa: "Empresa",
  grupo_codigo: "Grupo + Código",
  grupo: "Grupo",
  setor_codigo: "Setor + Código",
  setor: "Setor (Master)",
  setor_outro: "Geral (Master)",
  setor_hemodinamica_master: "Hemodinâmica (Master)",
  setor_master_geral: "Master Geral",
  default_setor: "Padrão do Motor",
  sem_regra: "Sem Regra",
  conflito: "Conflito",
};

// Quanto mais específico, mais "alto" = primário; default = neutro
export const RULE_MATCH_PRIORITY_TONES: Record<RuleMatchPriority, "primary" | "info" | "muted"> = {
  convenio_especialidade_codigo: "primary",
  convenio_especialidade: "primary",
  convenio_codigo: "primary",
  convenio: "primary",
  medico_codigo: "primary",
  medico: "primary",
  empresa_codigo: "info",
  empresa: "info",
  grupo_codigo: "info",
  grupo: "info",
  setor_codigo: "info",
  setor: "muted",
  setor_outro: "muted",
  setor_hemodinamica_master: "muted",
  setor_master_geral: "muted",
  default_setor: "muted",
  sem_regra: "muted",
  conflito: "muted",
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
  remessa: "Remessa",
  valor_fixo: "Valor fixo",
  plantao: "Plantão",
};

export const PAYMENT_TYPE_DESCRIPTIONS: Record<PaymentType, string> = {
  producao: "Mês seguinte ao mês em que houve a produção",
  remessa: "Pago só após faturamento e envio da cobrança ao convênio",
  valor_fixo: "Coordenação, assessoria e similares",
  plantao: "Pagamento por hora ou período",
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  atual: "Pagamento atual",
  pendencia: "Pendência",
  misto: "Misto (atual + pendência)",
};

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT_FMT = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });

// Parse "YYYY-MM-DD" como data UTC para evitar shift de fuso horário
// (new Date("2026-03-01") no Brasil viraria 28/02 21:00 e mostraria "fevereiro")
const parseAsUTC = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  return new Date(value);
};

const fmtSingle = (value: string) => MONTH_FMT.format(parseAsUTC(value));
const fmtSingleShort = (value: string) => MONTH_SHORT_FMT.format(parseAsUTC(value)).replace(".", "");

export const formatCompetence = (
  value: string | string[] | null | undefined,
) => {
  if (!value) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.length === 1) return fmtSingle(value[0]);
    const sorted = [...value].sort();
    if (sorted.length <= 3) return sorted.map(fmtSingleShort).join(" • ");
    return `${fmtSingleShort(sorted[0])} → ${fmtSingleShort(sorted[sorted.length - 1])} (${sorted.length})`;
  }
  return fmtSingle(value);
};

export const formatDateOnly = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
};