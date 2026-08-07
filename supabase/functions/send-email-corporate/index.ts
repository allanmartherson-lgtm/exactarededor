// Sends an email through the corporate mailbox connector (Microsoft Outlook or Gmail).
// Auto-detects which connector is linked based on available env secrets.
// Logs the attempt in notification_deliveries.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const GATEWAY = "https://connector-gateway.lovable.dev";

const AttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  content_type: z.string().min(1).max(200).optional(),
});

const BodySchema = z.object({
  to: z.string().email(),
  cc: z.array(z.string().email()).max(50).optional(),
  subject: z.string().min(1).max(500),
  html: z.string().min(1),
  text: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(20).optional(),
  user_id: z.string().uuid().optional(),
  payment_id: z.string().uuid().optional(),
  event_key: z.string().min(1),
  template_key: z.string().optional(),
  queue_id: z.string().uuid().optional(),
});


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Restringe a service-role interno OU usuários com role interno
  // (admin/diretor/analista/validador/gestao_medica). Portal users (empresa/médico)
  // não podem enviar e-mail pelo mailbox corporativo.
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const outlookKey = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY");
  const gmailKey = Deno.env.get("GOOGLE_MAIL_API_KEY");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: deliv } = await admin.from("notification_deliveries").insert({
    queue_id: body.queue_id ?? null,
    user_id: body.user_id ?? null,
    payment_id: body.payment_id ?? null,
    event_key: body.event_key,
    channel: "email",
    target_address: body.to,
    template_key: body.template_key ?? null,
    status: "queued",
    attempts: 1,
  }).select("id").single();

  if (!lovableKey) return finalize(admin, deliv?.id, "failed", null, "LOVABLE_API_KEY missing");

  try {
    if (outlookKey) {
      // Microsoft Graph: anexos simples via fileAttachment (contentBytes base64).
      // Limite prático do /sendMail: ~3 MB por requisição (mensagem + anexos).
      const graphAttachments = (body.attachments ?? []).map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.filename,
        contentType: a.content_type ?? "application/octet-stream",
        contentBytes: a.content_base64,
      }));
      const message: Record<string, unknown> = {
        subject: body.subject,
        body: { contentType: "HTML", content: body.html },
        toRecipients: [{ emailAddress: { address: body.to } }],
      };
      if (body.cc && body.cc.length > 0) {
        message.ccRecipients = body.cc.map((c) => ({ emailAddress: { address: c } }));
      }
      if (graphAttachments.length > 0) message.attachments = graphAttachments;

      const r = await fetch(`${GATEWAY}/microsoft_outlook/me/sendMail`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": outlookKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      const txt = await r.text();
      if (!r.ok) return finalize(admin, deliv?.id, "failed", null, `Outlook ${r.status}: ${txt}`);
      return finalize(admin, deliv?.id, "sent", null, null);
    }


    if (gmailKey) {
      const raw = buildRfc2822({ to: body.to, subject: body.subject, html: body.html, text: body.text });
      const r = await fetch(`${GATEWAY}/google_mail/gmail/v1/users/me/messages/send`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": gmailKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64url(raw) }),
      });
      const json2 = await r.json().catch(() => ({}));
      if (!r.ok) return finalize(admin, deliv?.id, "failed", null, `Gmail ${r.status}: ${JSON.stringify(json2)}`);
      return finalize(admin, deliv?.id, "sent", json2.id ?? null, null);
    }

    return finalize(admin, deliv?.id, "failed", null, "No email connector linked (Outlook/Gmail)");
  } catch (e) {
    return finalize(admin, deliv?.id, "failed", null, String(e));
  }
});

async function finalize(admin: any, id: string | undefined, status: string, providerId: string | null, error: string | null) {
  if (id) {
    await admin.from("notification_deliveries").update({
      status,
      provider_message_id: providerId,
      error_message: error,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      failed_at: status === "failed" ? new Date().toISOString() : null,
    }).eq("id", id);
  }
  return json({ success: status === "sent", delivery_id: id, error }, status === "sent" ? 200 : 502);
}

function buildRfc2822(p: { to: string; subject: string; html: string; text?: string }): string {
  return [
    `To: ${p.to}`,
    `Subject: ${p.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    p.html,
  ].join("\r\n");
}

function base64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
