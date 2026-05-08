
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
  (full ?? "").trim().split(/\s+/)[0] || "Analista";

const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

type EventType = "returned" | "ia_concluded" | "nf_received";

interface Body {
  paymentId: string;
  eventType: EventType;
  actorName?: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { paymentId, eventType, actorName, reason } = (await req.json()) as Body;
    if (!paymentId || !eventType) {
      return new Response(JSON.stringify({ error: "paymentId e eventType são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Busca o pagamento e o analista
    const { data: payment, error: pErr } = await supabase
      .from("payments")
      .select("id, reference, status, created_by")
      .eq("id", paymentId)
      .maybeSingle();

    if (pErr || !payment) {
      return new Response(JSON.stringify({ error: "Pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: analyst, error: aErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .eq("id", payment.created_by)
      .maybeSingle();

    if (aErr || !analyst) {
      return new Response(JSON.stringify({ error: "Analista não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const link = `${APP_BASE_URL}/pagamentos/${paymentId}`;
    const greeting = greetingForBrazil();
    const name = firstName(analyst.full_name);
    const reference = payment.reference ?? paymentId.slice(0, 8);

    let subject = "";
    let bodyText = "";

    switch (eventType) {
      case "returned":
        subject = `Lote ${reference} devolvido/rejeitado`;
        bodyText = `${greeting}, ${name}.\n\nO lote ${reference} foi devolvido para sua fila ${actorName ? `por ${actorName}` : "pelo validador/diretor"}.\n${reason ? `\nMotivo: ${reason}\n` : ""}\nAcesse para realizar os ajustes necessários: ${link}`;
        break;
      case "ia_concluded":
        subject = `Análise IA concluída - Lote ${reference}`;
        bodyText = `${greeting}, ${name}.\n\nA análise da IA para o lote ${reference} foi concluída e o lote aguarda sua revisão.\n\nAcessar: ${link}`;
        break;
      case "nf_received":
        subject = `Nota Fiscal recebida - Lote ${reference}`;
        // Para NF recebida, tentamos pegar o nome da empresa se disponível no payload ou via query
        bodyText = `${greeting}, ${name}.\n\nA nota fiscal do lote ${reference} foi recebida e aguarda sua ação.\n\nAcessar: ${link}`;
        break;
    }

    const html = `<p>${bodyText.replace(/\n/g, "<br/>")}</p>`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

    const emailResults: unknown[] = [];
    const whatsappResults: unknown[] = [];

    // Email
    if (analyst.email && LOVABLE_API_KEY && RESEND_API_KEY) {
      try {
        const r = await fetch(`${RESEND_GATEWAY}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [analyst.email],
            subject,
            html,
            text: bodyText,
          }),
        });
        const json = await r.json().catch(() => ({}));
        emailResults.push({ ok: r.ok, status: r.status, response: json });
      } catch (e) {
        emailResults.push({ ok: false, error: String(e) });
      }
    }

    // WhatsApp
    const phoneDigits = onlyDigits(analyst.phone ?? "");
    if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
      try {
        const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
        const params = new URLSearchParams({
          To: `whatsapp:${e164}`,
          From: TWILIO_FROM,
          Body: bodyText,
        });
        const r = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });
        const json = await r.json().catch(() => ({}));
        whatsappResults.push({ ok: r.ok, status: r.status, response: json });
      } catch (e) {
        whatsappResults.push({ ok: false, error: String(e) });
      }
    }

    // Auditoria
    await supabase.from("audit_log").insert({
      actor_id: null, // Sistema
      entity_type: "payment",
      entity_id: paymentId,
      action: `notify_analyst_${eventType}`,
      diff: {
        event: eventType,
        recipient: { id: analyst.id, email: analyst.email },
        sent_at: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({ ok: true, emailResults, whatsappResults }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-analyst-event error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
