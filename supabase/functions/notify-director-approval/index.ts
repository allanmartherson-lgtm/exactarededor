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

const brl = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (!Number.isFinite(n as number)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n as number);
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;")
   .replace(/'/g, "&#039;");

const buildEmailText = (
  greeting: string,
  name: string,
  paymentRef: string,
  totalFormatted: string,
  companyCount: number,
  link: string,
) =>
  `${greeting}, ${name}.

Há um pagamento aguardando sua aprovação no MedPay.

Pagamento: ${paymentRef}
Valor total: ${totalFormatted}
Empresas: ${companyCount}

Acessar: ${link}

—
MedPay · Hospital DF Star · Rede D'Or
Você está recebendo este e-mail porque é um diretor aprovador no MedPay.`;

const buildEmailHtml = (
  greeting: string,
  name: string,
  paymentRef: string,
  totalFormatted: string,
  companyCount: number,
  link: string,
) => {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Pagamento aguardando aprovação — MedPay</title>
</head>
<body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EFE8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;border:0.5px solid #D3D1C7;">
          <!-- Header -->
          <tr>
            <td style="background:#9A6B3A;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-size:18px;font-weight:500;color:#FFFFFF;letter-spacing:0.3px;">MedPay</td>
                  <td align="right" style="font-size:12px;color:rgba(255,255,255,0.75);">Hospital DF Star</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="font-size:16px;color:#2C2C2A;margin:0 0 8px;">${greeting}, Prezado(a) ${escapeHtml(name)}.</p>
              <p style="font-size:14px;color:#5F5E5A;margin:0 0 24px;line-height:1.6;">Há um pagamento aguardando sua aprovação no MedPay.</p>

              <!-- Card cinza com dados -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EFE8;border-radius:10px;margin:0 0 28px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="font-size:11px;color:#888780;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Pagamento</p>
                    <p style="font-size:16px;color:#2C2C2A;margin:0 0 18px;font-weight:500;">${escapeHtml(paymentRef)}</p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td width="50%" style="vertical-align:top;">
                          <p style="font-size:11px;color:#888780;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Valor total</p>
                          <p style="font-size:18px;color:#2C2C2A;margin:0;font-weight:500;">${totalFormatted}</p>
                        </td>
                        <td width="50%" style="vertical-align:top;">
                          <p style="font-size:11px;color:#888780;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Empresas</p>
                          <p style="font-size:18px;color:#2C2C2A;margin:0;font-weight:500;">${companyCount}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <a href="${link}" style="display:inline-block;background:#9A6B3A;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Acessar no MedPay</a>
                  </td>
                </tr>
              </table>

              <p style="font-size:12px;color:#888780;margin:0;text-align:center;line-height:1.6;">Você está recebendo este e-mail porque é um diretor aprovador no MedPay.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F1EFE8;padding:16px 32px;text-align:center;border-top:0.5px solid #D3D1C7;">
              <p style="font-size:11px;color:#888780;margin:0;">MedPay · Hospital DF Star · Rede D'Or</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildWhatsappBody = (
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

    // Confirmar que o pagamento de fato está em aguardando_aprovacao + contar empresas
    const [paymentRes, companyCountRes] = await Promise.all([
      supabase
        .from("payments")
        .select("id, reference, status, total_amount")
        .eq("id", paymentId)
        .maybeSingle(),
      supabase
        .from("payment_company_groups")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", paymentId),
    ]);
    const payment = paymentRes.data;
    const pErr = paymentRes.error;
    const companyCount = companyCountRes.count ?? 0;

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
      const totalFormatted = brl(payment.total_amount);
      const text = buildEmailText(greeting, name, payment.reference, totalFormatted, companyCount, link);
      const html = buildEmailHtml(greeting, name, payment.reference, totalFormatted, companyCount, link);

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
              subject: `Pagamento "${payment.reference}" aguarda sua aprovação — MedPay`,
              html,
              text,
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
          const waBody = buildWhatsappBody(greeting, name, link);
          const params = new URLSearchParams({
            To: `whatsapp:${e164}`,
            From: TWILIO_FROM,
            Body: waBody,
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
