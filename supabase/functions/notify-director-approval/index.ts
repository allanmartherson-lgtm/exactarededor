// Notifica diretores via Email (Resend) e WhatsApp (Twilio Sandbox) quando
// um pagamento entra em "aguardando_aprovacao". Idempotente por payment_id
// (controle em payment_director_notifications).

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
  // Horário de Brasília (UTC-3, sem DST)
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return "Bom dia";
  if (brHour >= 12 && brHour < 18) return "Boa tarde";
  return "Boa noite";
};

const firstName = (full?: string | null) =>
  (full ?? "").trim().split(/\s+/)[0] || "Diretor(a)";

const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

const buildBody = (
  greeting: string,
  name: string,
  link: string,
) =>
  `${greeting}, ${name}.\n\nHá um novo pagamento aguardando sua aprovação no MedPay.\n\nAcessar: ${link}`;

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

    // Idempotência: se já notificamos este pagamento, não disparar de novo.
    const { data: existing } = await supabase
      .from("payment_director_notifications")
      .select("id")
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ skipped: true, reason: "already_notified" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirmar que o pagamento de fato está em aguardando_aprovacao
    const { data: payment, error: pErr } = await supabase
      .from("payments")
      .select("id, reference, status, total_amount")
      .eq("id", paymentId)
      .maybeSingle();
    if (pErr || !payment) {
      return new Response(JSON.stringify({ error: "Pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (payment.status !== "aguardando_aprovacao") {
      return new Response(JSON.stringify({ skipped: true, reason: "wrong_status", status: payment.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pega todos os diretores
    const { data: roles, error: rErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "diretor");
    if (rErr) throw rErr;
    const directorIds = (roles ?? []).map((r) => r.user_id);
    if (directorIds.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_directors" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: directors, error: dErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", directorIds);
    if (dErr) throw dErr;

    const link = `${APP_BASE_URL}/pagamentos/${paymentId}`;
    const greeting = greetingForBrazil();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

    const emailResults: unknown[] = [];
    const whatsappResults: unknown[] = [];

    for (const d of directors ?? []) {
      const name = firstName(d.full_name);
      const body = buildBody(greeting, name, link);
      const html = `<p>${body.replace(/\n/g, "<br/>")}</p>`;

      // Email via Resend gateway
      if (d.email && LOVABLE_API_KEY && RESEND_API_KEY) {
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
              to: [d.email],
              subject: "Pagamento aguardando sua aprovação — MedPay",
              html,
              text: body,
            }),
          });
          const json = await r.json().catch(() => ({}));
          emailResults.push({ director_id: d.id, ok: r.ok, status: r.status, response: json });
        } catch (e) {
          emailResults.push({ director_id: d.id, ok: false, error: String(e) });
        }
      } else {
        emailResults.push({ director_id: d.id, ok: false, skipped: "missing_email_or_keys" });
      }

      // WhatsApp via Twilio gateway
      const phoneDigits = onlyDigits(d.phone ?? "");
      if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
        try {
          // Garantir prefixo Brasil se vier 11 dígitos
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
          whatsappResults.push({ director_id: d.id, ok: r.ok, status: r.status, response: json });
        } catch (e) {
          whatsappResults.push({ director_id: d.id, ok: false, error: String(e) });
        }
      } else {
        whatsappResults.push({ director_id: d.id, ok: false, skipped: "missing_phone_or_keys" });
      }
    }

    // Marca como notificado (mesmo com falhas individuais — evita spam em retries do client)
    await supabase.from("payment_director_notifications").insert({
      payment_id: paymentId,
      email_results: emailResults,
      whatsapp_results: whatsappResults,
    });

    return new Response(
      JSON.stringify({ ok: true, directors: directors?.length ?? 0, emailResults, whatsappResults }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-director-approval error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
