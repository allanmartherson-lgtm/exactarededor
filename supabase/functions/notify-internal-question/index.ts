// Notifica usuários internos sobre criação/resposta de perguntas (questionamentos
// internos) num lote. O roteamento é definido pelo PAPEL DE QUEM PERGUNTA, não
// pelo estado do lote:
//
//   analista    -> validador (se em validação) ou diretor (se em aprovação)
//   validador   -> analista do lote
//   diretor     -> analista + validador (notificação dupla)
//
// Para "respondida":
//   Se houver outras perguntas abertas: silencia (notifica apenas uma vez por ciclo).
//   Se for a última pergunta: notifica o diretor responsável (todos os diretores).
//
// Suporta payload com `recipient_roles: string[]` (override explícito).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox
const EMAIL_FROM = "MedPay <onboarding@resend.dev>";

const greetingForBrazil = (now = new Date()) => {
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return "Bom dia";
  if (brHour >= 12 && brHour < 18) return "Boa tarde";
  return "Boa noite";
};
const firstName = (full?: string | null) =>
  (full ?? "").trim().split(/\s+/)[0] || "Olá";
const fmtBR = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

type Role = "analista" | "validador" | "diretor" | "admin";
type EventKind = "created" | "resolved";

interface Body {
  /** "created" (pergunta nova) ou "resolved" (pergunta respondida). */
  event: EventKind;
  payment_id: string;
  /** id da observação que é a pergunta. */
  question_observation_id: string;
  /** Papel de quem perguntou — usado para roteamento quando não há recipient_roles. */
  asker_role?: Role | null;
  /** Override opcional: papéis a notificar. Se ausente, usa matriz. */
  recipient_roles?: Role[];
  /** Para "resolved": id do usuário que respondeu (não recebe notificação). */
  responder_id?: string | null;
}

/** Resolve papéis-alvo a partir do papel de quem perguntou + status do lote. */
export function defaultRecipientsForCreated(
  askerRole: Role | null | undefined,
  paymentStatus: string | null,
): Role[] {
  if (askerRole === "validador") return ["analista"];
  if (askerRole === "diretor" || askerRole === "admin") return ["analista", "validador"];
  // analista (ou desconhecido): roteia pelo estado do lote.
  if (paymentStatus === "aguardando_aprovacao" || paymentStatus === "aprovado_em_revisao") return ["diretor"];
  return ["validador"];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.payment_id || !body?.question_observation_id || !body?.event) {
      return new Response(
        JSON.stringify({ error: "payment_id, question_observation_id e event são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: payment } = await supabase
      .from("payments")
      .select("id, reference, status, created_by, validated_by")
      .eq("id", body.payment_id)
      .maybeSingle();
    if (!payment) {
      return new Response(JSON.stringify({ error: "pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: question } = await supabase
      .from("payment_observations")
      .select("id, payment_id, author_id, author_type, message, created_at, resolved_at, resolved_by")
      .eq("id", body.question_observation_id)
      .maybeSingle();
    if (!question) {
      return new Response(JSON.stringify({ error: "pergunta não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se for resolução, verifica se restam outras perguntas abertas no lote
    let isLastInCycle = false;
    if (body.event === "resolved") {
      const { count } = await supabase
        .from("payment_observations")
        .select("*", { count: "exact", head: true })
        .eq("payment_id", body.payment_id)
        .eq("is_question", true)
        .is("resolved_at", null);
      
      isLastInCycle = (count === 0);
      
      // Regra: notificação dispara apenas quando o ÚLTIMO questionamento é respondido
      if (!isLastInCycle) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "not_last_in_cycle" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Determina destinatários (lista de userIds).
    let recipientIds: string[] = [];
    let actorName: string | null = null;

    if (body.event === "resolved") {
      // Quando o ciclo acaba, notificamos os diretores responsáveis (todos do papel 'diretor')
      const { data: directorRoles } = await supabase
        .from("user_roles").select("user_id").eq("role", "diretor");
      
      const directorIds = (directorRoles ?? []).map(r => r.user_id);
      
      // Notifica também o autor original da última pergunta resolvida
      const authorId = question.author_id ? [question.author_id] : [];
      
      // Adiciona Analista (created_by) e Validador (validated_by) do lote
      const flowParticipants = [payment.created_by, payment.validated_by].filter(Boolean) as string[];
      
      recipientIds = Array.from(new Set([...directorIds, ...authorId, ...flowParticipants]))
        .filter(id => id !== body.responder_id);

      if (body.responder_id) {
        const { data: r } = await supabase.from("profiles")
          .select("full_name, email").eq("id", body.responder_id).maybeSingle();
        actorName = r?.full_name ?? r?.email ?? null;
      }
    } else {
      const roles: Role[] = body.recipient_roles?.length
        ? body.recipient_roles
        : defaultRecipientsForCreated(body.asker_role, payment.status);
      const { data: rls } = await supabase
        .from("user_roles").select("user_id, role").in("role", roles);
      recipientIds = Array.from(new Set((rls ?? []).map((r) => r.user_id)))
        .filter((id) => id !== question.author_id);
      if (question.author_id) {
        const { data: a } = await supabase.from("profiles")
          .select("full_name, email").eq("id", question.author_id).maybeSingle();
        actorName = a?.full_name ?? a?.email ?? null;
      }
    }

    let recipients: { id: string; full_name: string | null; email: string; phone: string | null }[] = [];
    if (recipientIds.length) {
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name, email, phone").in("id", recipientIds);
      recipients = (profs ?? []) as typeof recipients;
    }

    const sentAt = new Date().toISOString();
    const link = `${APP_BASE_URL}/pagamentos/${payment.id}`;
    const greeting = greetingForBrazil();
    const isCreated = body.event === "created";
    const subject = isCreated
      ? `Nova pergunta no lote ${payment.reference}`
      : `Questionamento respondido no lote ${payment.reference}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    const emailResults: unknown[] = [];
    const whatsappResults: unknown[] = [];

    for (const r of recipients) {
      const name = firstName(r.full_name);
      const lines = isCreated
        ? [
            `${greeting}, ${name}.`,
            ``,
            `Há uma nova pergunta no lote ${payment.reference}.`,
            body.asker_role === "diretor"
              ? `Observação: Esta pergunta foi feita pela diretoria. O lote continua aguardando aprovação e a resposta pode ser dada pelo analista ou pelo validador.`
              : `Há uma nova pergunta aguardando resposta.`,
            actorName ? `• Perguntado por: ${actorName}` : null,
            `• Mensagem: ${(question.message ?? "").slice(0, 240)}`,
            `• Em: ${fmtBR(sentAt)}`,
            ``,
            `Acessar: ${link}`,
          ].filter(Boolean) as string[]
        : [
            `${greeting}, ${name}.`,
            ``,
            `O questionamento no lote ${payment.reference} foi resolvido e o fluxo agora pode prosseguir.`,
            actorName ? `• Resolvido por: ${actorName}` : null,
            `• Mensagem: ${(question.message ?? "").slice(0, 240)}`,
            `• Em: ${fmtBR(sentAt)}`,
            ``,
            `Acessar: ${link}`,
          ].filter(Boolean) as string[];

      const text = lines.join("\n");
      const html = `<p>${text.replace(/\n/g, "<br/>")}</p>`;

      // Envia Email
      if (r.email && LOVABLE_API_KEY && RESEND_API_KEY) {
        try {
          const resp = await fetch(`${RESEND_GATEWAY}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": RESEND_API_KEY,
            },
            body: JSON.stringify({ from: EMAIL_FROM, to: [r.email], subject, html, text }),
          });
          const j = await resp.json().catch(() => ({}));
          emailResults.push({ recipient_id: r.id, ok: resp.ok, status: resp.status, response: j });
        } catch (e) {
          emailResults.push({ recipient_id: r.id, ok: false, error: String(e) });
        }
      }

      // Envia WhatsApp (apenas se for diretor ou for o encerramento do ciclo)
      const phoneDigits = onlyDigits(r.phone ?? "");
      if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
        try {
          const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
          const params = new URLSearchParams({
            To: `whatsapp:${e164}`,
            From: TWILIO_FROM,
            Body: text,
          });
          const resp = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": TWILIO_API_KEY,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          });
          const j = await resp.json().catch(() => ({}));
          whatsappResults.push({ recipient_id: r.id, ok: resp.ok, status: resp.status, response: j });
        } catch (e) {
          whatsappResults.push({ recipient_id: r.id, ok: false, error: String(e) });
        }
      }
    }

    await supabase.from("audit_log").insert({
      actor_id: body.event === "resolved" ? body.responder_id ?? null : question.author_id,
      entity_type: "payment_observation",
      entity_id: question.id,
      action: isCreated ? "internal_question_created" : "internal_question_resolved",
      diff: {
        payment: { id: payment.id, reference: payment.reference, status: payment.status },
        question_id: question.id,
        asker_role: body.asker_role ?? question.author_type ?? null,
        recipients: recipients.map((r) => ({ id: r.id, email: r.email })),
        is_last_in_cycle: isLastInCycle,
        sent_at: sentAt,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        recipients: recipients.length,
        email_results: emailResults,
        whatsapp_results: whatsappResults,
        sent_at: sentAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-internal-question error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});