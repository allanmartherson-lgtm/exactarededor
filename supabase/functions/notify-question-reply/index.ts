import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import { b6_questionReply } from "../_shared/emailTemplates/templates.ts";


import { sendCorporateEmail } from "../_shared/sendCorporateEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Notifica por e-mail o recebedor da NF de que o analista respondeu sua dúvida no portal.
 * Mantém formato simples (texto) e reusa o template transacional `invoice-question-reply`.
 * Se o template não existir no provedor, o fallback é usar `invoice-request` com um
 * `requestMessage` customizado — o destinatário recebe a resposta inline.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const { invoice_id, message, author_name, question_id } = await req.json();
    if (!invoice_id || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "invoice_id e message são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, recipient_email, recipient_cc, upload_token, payment_id, company_name")
      .eq("id", invoice_id)
      .maybeSingle();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("reference, description")
      .eq("id", invoice.payment_id)
      .maybeSingle();

    // Anexos da resposta — só inclui no e-mail se couberem em ~3MB no total.
    // Limite prático do Microsoft Graph /sendMail (anexo simples, base64 inline).
    // Se exceder, manda só o link pro portal.
    const MAX_TOTAL = 3 * 1024 * 1024;
    type EmailAttachment = { filename: string; content: string; contentType?: string };
    const emailAttachments: EmailAttachment[] = [];
    let attachedAll = true;
    let totalBytes = 0;
    if (question_id) {
      const { data: atts } = await supabase
        .from("invoice_question_attachments")
        .select("file_name, storage_path, mime_type, size_bytes")
        .eq("question_id", question_id);
      for (const a of atts ?? []) {
        if (totalBytes + Number(a.size_bytes) > MAX_TOTAL) { attachedAll = false; continue; }
        const { data: blob, error: dlErr } = await supabase.storage
          .from("invoice-question-attachments")
          .download(a.storage_path);
        if (dlErr || !blob) { attachedAll = false; continue; }
        const buf = new Uint8Array(await blob.arrayBuffer());
        // base64 — provedores transacionais (Resend, etc.) costumam aceitar nesse formato.
        let bin = "";
        for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
        emailAttachments.push({
          filename: a.file_name,
          content: btoa(bin),
          contentType: a.mime_type,
        });
        totalBytes += Number(a.size_bytes);
      }
    }

    const portalUrl = `${Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".lovable.app")}/portal/nf/${invoice.upload_token}`;
    // Não dá pra adivinhar o domínio do portal aqui de forma 100% confiável. O e-mail
    // mostra o link mesmo assim — o cliente pode customizar via PUBLIC_PORTAL_URL.
    const publicBase = Deno.env.get("PUBLIC_PORTAL_URL");
    const link = publicBase ? `${publicBase.replace(/\/$/, "")}/portal/nf/${invoice.upload_token}` : portalUrl;

    const rendered = b6_questionReply({
      recipient_name: invoice.company_name ?? "prezado(a)",
      payment_reference: payment?.reference ?? invoice.company_name ?? "",
      replied_by: author_name ?? "Analista",
      reply_preview: message.trim().slice(0, 400),
      thread_link: link,
      subject: `Resposta sobre o pedido de NF — ${payment?.reference ?? invoice.company_name ?? ""}`.trim(),
    });
    const attachmentsNote = emailAttachments.length > 0
      ? `\n\nAnexos (${emailAttachments.length}): ${emailAttachments.map((a) => a.filename).join(", ")}${attachedAll ? "" : " — alguns anexos eram grandes demais para o e-mail; veja todos no portal."}`
      : "";
    const subject = rendered.subject;
    const html = rendered.html;
    const body = rendered.text + attachmentsNote;


    try {
      const toList = [invoice.recipient_email].filter((x): x is string => Boolean(x));
      if (toList.length === 0) throw new Error("Invoice sem recipient_email");
      const rawCc = (invoice as { recipient_cc?: string[] | string | null }).recipient_cc;
      const ccList = (Array.isArray(rawCc) ? rawCc : rawCc ? [rawCc] : [])
        .filter((x): x is string => Boolean(x) && x !== invoice.recipient_email);

      const sendRes = await sendCorporateEmail({
        to: toList[0],
        cc: ccList.length > 0 ? ccList : undefined,
        subject,
        html,
        text: body,
        attachments: emailAttachments.length > 0
          ? emailAttachments.map((a) => ({
              filename: a.filename,
              content_base64: a.content,
              content_type: a.contentType,
            }))
          : undefined,
        payment_id: payment?.id ?? undefined,
        event_key: "invoice_question_reply",
        template_key: "b6_question_reply",
      });
      if (!sendRes.ok) throw new Error(sendRes.error ?? "Falha no envio corporativo");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notify-question-reply] falha ao enviar e-mail:", msg);
      return new Response(JSON.stringify({ ok: false, warning: msg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify-question-reply] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});