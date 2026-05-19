import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    // Anexos da resposta — só inclui no e-mail se couberem em ~10MB no total
    // (limite prático do Resend). Se exceder, manda só o link pro portal.
    const MAX_TOTAL = 10 * 1024 * 1024;
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

    const subject = `Resposta sobre o pedido de NF — ${payment?.reference ?? invoice.company_name ?? ""}`.trim();
    const body = [
      `Olá,`,
      ``,
      `O analista${author_name ? ` ${author_name}` : ""} respondeu sua dúvida sobre o pedido de NF${payment?.reference ? ` "${payment.reference}"` : ""}:`,
      ``,
      `"${message.trim()}"`,
      ``,
      emailAttachments.length > 0
        ? `Anexos (${emailAttachments.length}): ${emailAttachments.map((a) => a.filename).join(", ")}${attachedAll ? "" : " — alguns anexos eram grandes demais para o e-mail; veja todos no portal."}`
        : "",
      `Para responder ou enviar a NF, acesse o link abaixo:`,
      link,
    ].filter(Boolean).join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ou RESEND_API_KEY ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toList = [invoice.recipient_email].filter(Boolean) as string[];
    const ccList = Array.isArray(invoice.recipient_cc) ? invoice.recipient_cc.filter(Boolean) : [];

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <tr>
      <td style="background:#1E3A5F;padding:28px 40px">
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;opacity:0.7">Hospital DF Star</div>
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:20px;font-weight:700">Resposta ao seu questionamento</div>
      </td>
    </tr>
    <tr>
      <td style="padding:36px 40px 0 40px;font-family:Arial,sans-serif">
        <p style="margin:0 0 20px 0;font-size:14px;color:#1a1a2e">Ol\u00e1,</p>
        <p style="margin:0 0 24px 0;font-size:14px;color:#444;line-height:1.6">
          O analista${author_name ? ` <strong>${author_name}</strong>` : ""} respondeu sua d\u00favida referente ao pedido de NF${payment?.reference ? ` — <strong>${payment.reference}</strong>` : ""}:
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;border-left:4px solid #1E3A5F;border-radius:6px;margin-bottom:28px">
          <tr>
            <td style="padding:20px 24px;font-family:Arial,sans-serif;font-size:14px;color:#1a1a2e;line-height:1.7;font-style:italic">
              "${message.trim()}"
            </td>
          </tr>
        </table>
        ${emailAttachments.length > 0 ? `
        <p style="margin:0 0 20px 0;font-family:Arial,sans-serif;font-size:13px;color:#555">
          ${emailAttachments.length} anexo(s) inclu\u00eddo(s)${!attachedAll ? " — alguns arquivos eram grandes demais para o e-mail; acesse o portal para ver todos." : "."}
        </p>` : ""}
        <p style="margin:0 0 20px 0;font-family:Arial,sans-serif;font-size:13px;color:#555;line-height:1.6">
          Para responder ou enviar a Nota Fiscal, acesse o portal abaixo:
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
          <tr>
            <td align="center">
              <a href="${link}" style="display:inline-block;background:#1E3A5F;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:700">
                Acessar Portal →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background:#f0f4f8;padding:20px 40px;border-top:1px solid #e2e8f0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:Arial,sans-serif;font-size:12px;color:#666">
              Atenciosamente,<br/>
              <strong style="color:#1E3A5F">GHM DF Star</strong>
            </td>
            <td align="right" style="font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.7">
              ghm.repassedfstar@rededor.com.br<br/>
              (11) 2142-4879
            </td>
          </tr>
        </table>
        <div style="font-family:Arial,sans-serif;font-size:11px;color:#aaa;margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0">
          Este link \u00e9 \u00fanico e intransfer\u00edvel. Em caso de d\u00favidas, responda este e-mail.
        </div>
      </td>
    </tr>
  </table>
  </td></tr>
</table>
</body>
</html>`;

    try {
      const resendResp = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: "MedPay <onboarding@resend.dev>",
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          html,
          attachments: emailAttachments.length > 0
            ? emailAttachments.map((a) => ({ filename: a.filename, content: a.content }))
            : undefined,
        }),
      });
      if (!resendResp.ok) {
        const errBody = await resendResp.text();
        throw new Error(`Resend ${resendResp.status}: ${errBody}`);
      }
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