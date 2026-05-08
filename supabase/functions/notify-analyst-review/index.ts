// Notifica o analista responsável via Email (Resend) e WhatsApp (Twilio Sandbox) quando
// um pagamento é aprovado pelo diretor e entra em "aprovado_em_revisao".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://medpay-approval.lovable.app";
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

const buildBody = (
  greeting: string,
  name: string,
  reference: string,
  link: string,
) =>
  `${greeting}, ${name}.\n\nO pagamento "${reference}" foi aprovado pelo diretor e está pronto para sua revisão final antes do envio do pedido de nota.\n\nAcessar: ${link}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { paymentId } = await req.json();
    if (!paymentId || typeof paymentId !== "string") {
      return new Response(JSON.stringify({ error: "paymentId obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Confirmar que o pagamento de fato está em aprovado_em_revisao
    const { data: payment, error: pErr } = await supabase
      .from("payments")
      .select("id, reference, status, total_amount, created_by")
      .eq("id", paymentId)
      .maybeSingle();
    if (pErr || !payment) {
      return new Response(JSON.stringify({ error: "Pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (payment.status !== "aprovado_em_revisao") {
      return new Response(JSON.stringify({ skipped: true, reason: "wrong_status", status: payment.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pega o analista (criador do lote)
    const { data: analyst, error: dErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .eq("id", payment.created_by)
      .single();
    if (dErr) throw dErr;

    const link = `${APP_BASE_URL}/pagamentos/${paymentId}`;
    const greeting = greetingForBrazil();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

    const emailResults: unknown[] = [];
    const whatsappResults: unknown[] = [];

    const name = firstName(analyst.full_name);
    const body = buildBody(greeting, name, payment.reference, link);
    const html = `<p>${body.replace(/\n/g, "<br/>")}</p>`;

    // Email via Resend gateway
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
            subject: "Pagamento aprovado para revisão final — MedPay",
            html,
            text: body,
          }),
        });
        const json = await r.json().catch(() => ({}));
        emailResults.push({ analyst_id: analyst.id, ok: r.ok, status: r.status, response: json });
      } catch (e) {
        emailResults.push({ analyst_id: analyst.id, ok: false, error: String(e) });
      }
    }

    // WhatsApp via Twilio gateway
    const phoneDigits = onlyDigits(analyst.phone ?? "");
    if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
      try {
        const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
        const params = new URLSearchParams({
          To: `whatsapp:${e164}`,
          From: TWILIO_FROM,
          Body: body,
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
        whatsappResults.push({ analyst_id: analyst.id, ok: r.ok, status: r.status, response: json });
      } catch (e) {
        whatsappResults.push({ analyst_id: analyst.id, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, analyst: analyst.id, emailResults, whatsappResults }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-analyst-review error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
