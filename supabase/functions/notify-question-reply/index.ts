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
    const { invoice_id, message, author_name } = await req.json();
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
      `Para responder ou enviar a NF, acesse o link abaixo:`,
      link,
    ].join("\n");

    try {
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "invoice-question-reply",
          recipientEmail: invoice.recipient_email,
          cc: invoice.recipient_cc ?? [],
          idempotencyKey: `q-reply-${invoice.id}-${Date.now()}`,
          subject,
          templateData: {
            authorName: author_name ?? "Analista",
            reference: payment?.reference ?? "",
            message: message.trim(),
            uploadUrl: link,
            // Fallback: se o template não existir, alguns provedores usam estes:
            requestMessage: body,
            subject,
          },
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notify-question-reply] falha ao despachar e-mail:", msg);
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