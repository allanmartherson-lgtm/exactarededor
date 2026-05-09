import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { PaymentStatus } from "@/lib/status";
import {
  Bot, Sparkles, ShieldCheck, UserCog, ClipboardList, User as UserIcon,
  type LucideIcon,
} from "lucide-react";

type ObservationRow = Database["public"]["Tables"]["payment_observations"]["Row"];
export type ObservationType = Database["public"]["Tables"]["payment_observations"]["Row"]["observation_type"];
export type ObservationAuthorType = ObservationRow["author_type"];

/**
 * Rótulo legível do papel do autor de uma observação/registro de histórico.
 */
export function authorRoleLabel(t: string | null | undefined): string {
  switch (t) {
    case "analista": return "Analista";
    case "validador": return "Validador";
    case "diretor": return "Diretor";
    case "admin": return "Administrador";
    case "sistema": return "Sistema";
    case "ia": return "IA";
    default: return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
  }
}

/**
 * Identidade visual unificada por papel — usada em TODAS as telas de
 * histórico/timeline/auditoria para que o leitor reconheça rapidamente
 * "quem fez o quê" só pela cor + ícone. Tokens semânticos do design system.
 */
export type RoleVisual = {
  label: string;
  Icon: LucideIcon;
  /** Classe para badge (bg + texto + borda). */
  badgeClass: string;
  /** Classe de borda lateral esquerda — para cards/itens da timeline. */
  borderClass: string;
  /** Cor sólida para bullets/dots. */
  dotClass: string;
};

const ROLE_VISUALS: Record<string, RoleVisual> = {
  ia: {
    label: "IA", Icon: Bot,
    badgeClass: "bg-info-soft text-info border-info/30",
    borderClass: "border-l-info", dotClass: "bg-info",
  },
  sistema: {
    label: "Sistema", Icon: Sparkles,
    badgeClass: "bg-muted text-muted-foreground border-border",
    borderClass: "border-l-muted-foreground", dotClass: "bg-muted-foreground",
  },
  analista: {
    label: "Analista", Icon: ClipboardList,
    badgeClass: "bg-success-soft text-success border-success/30",
    borderClass: "border-l-success", dotClass: "bg-success",
  },
  validador: {
    label: "Validador", Icon: ShieldCheck,
    badgeClass: "bg-primary-soft text-primary border-primary/30",
    borderClass: "border-l-primary", dotClass: "bg-primary",
  },
  diretor: {
    label: "Diretor", Icon: UserCog,
    badgeClass: "bg-warning-soft text-warning-foreground border-warning/40",
    borderClass: "border-l-warning", dotClass: "bg-warning",
  },
  admin: {
    label: "Administrador", Icon: UserCog,
    badgeClass: "bg-warning-soft text-warning-foreground border-warning/40",
    borderClass: "border-l-warning", dotClass: "bg-warning",
  },
};

const ROLE_FALLBACK: RoleVisual = {
  label: "—", Icon: UserIcon,
  badgeClass: "bg-muted text-muted-foreground border-border",
  borderClass: "border-l-border", dotClass: "bg-muted-foreground",
};

/** Identidade visual (cor + ícone + label) por papel. */
export function getRoleVisual(role: string | null | undefined): RoleVisual {
  if (!role) return ROLE_FALLBACK;
  return ROLE_VISUALS[role] ?? ROLE_FALLBACK;
}

export type RecordObservationInput = {
  payment_id: string;
  author_type: ObservationAuthorType;
  author_id: string;
  message: string;
  item_id?: string | null;
  status_from?: PaymentStatus | null;
  status_to?: PaymentStatus | null;
  /** Marca como pergunta — fica como "questionamento aberto" até ser respondida. */
  is_question?: boolean;
  /** Quando esta observação é a RESPOSTA a uma pergunta, informa a pergunta-alvo. */
  answers_question_id?: string | null;
  /** Classificação da observação para destaque e filtros. */
  observation_type?: ObservationType;
};

export type RecordObservationResult = {
  ok: boolean;
  /** Mensagem de erro quando ok=false. String vazia em caso de sucesso. */
  error: string;
  /** Linha inserida quando ok=true. null em caso de erro. */
  data: ObservationRow | null;
};

/**
 * Insere uma observação no histórico do pagamento de forma consistente.
 *
 * Centralizar isso evita:
 *  - payloads divergentes entre origens (NewPayment, Invoices, PaymentDetail);
 *  - falhas silenciosas — sempre retorna `{ ok, error }` para o caller decidir;
 *  - omitir campos opcionais por engano (item_id, status_from/to).
 *
 * IMPORTANTE: o caller é responsável por exibir toast/feedback de erro.
 */
export async function recordObservation(
  input: RecordObservationInput,
): Promise<RecordObservationResult> {
  const payload = {
    payment_id: input.payment_id,
    author_type: input.author_type,
    author_id: input.author_id,
    message: input.message,
    item_id: input.item_id ?? null,
    status_from: input.status_from ?? null,
    status_to: input.status_to ?? null,
    is_question: !!input.is_question,
    observation_type: input.observation_type ?? "informativo",
  };

  const { data, error } = await supabase
    .from("payment_observations")
    .insert(payload)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Falha ao salvar observação.", data: null };
  }

  // Se esta observação é a RESPOSTA a uma pergunta existente, marca a pergunta
  // como resolvida e linka via answered_by_observation_id.
  if (input.answers_question_id) {
    await resolveQuestion(input.answers_question_id, input.author_id, data.id, input.author_type);
  }

  // Se esta observação É uma pergunta, dispara notificação interna roteada
  // pelo papel de quem perguntou (best-effort; falha de notificação não derruba).
  if (payload.is_question) {
    try {
      await supabase.functions.invoke("notify-internal-question", {
        body: {
          event: "created",
          payment_id: input.payment_id,
          question_observation_id: data.id,
          asker_role: input.author_type,
        },
      });
    } catch (e) {
      console.warn("notify-internal-question(created) failed", e);
    }
  }

  return { ok: true, data: data as ObservationRow, error: "" };
}

/**
 * Marca uma pergunta como resolvida e dispara notificação ao autor original.
 * Idempotente: se já estiver resolvida, retorna ok.
 */
export async function resolveQuestion(
  questionId: string,
  responderId: string,
  answerObservationId?: string | null,
  responderRole?: ObservationAuthorType | null,
): Promise<{ ok: boolean; error: string }> {
  const { data: existing } = await supabase
    .from("payment_observations")
    .select("id, payment_id, resolved_at")
    .eq("id", questionId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Pergunta não encontrada" };
  if (existing.resolved_at) return { ok: true, error: "" };

  const { error } = await supabase
    .from("payment_observations")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: responderId,
      answered_by_observation_id: answerObservationId ?? null,
    })
    .eq("id", questionId);
  if (error) return { ok: false, error: error.message };

  try {
    await supabase.functions.invoke("notify-internal-question", {
      body: {
        event: "resolved",
        payment_id: existing.payment_id,
        question_observation_id: questionId,
        responder_id: responderId,
        asker_role: responderRole ?? null,
      },
    });
  } catch (e) {
    console.warn("notify-internal-question(resolved) failed", e);
  }
  return { ok: true, error: "" };
}

/** Reabre uma pergunta previamente respondida. Sem notificação. */
export async function reopenQuestion(questionId: string): Promise<{ ok: boolean; error: string }> {
  const { error } = await supabase
    .from("payment_observations")
    .update({ resolved_at: null, resolved_by: null, answered_by_observation_id: null })
    .eq("id", questionId);
  return { ok: !error, error: error?.message ?? "" };
}