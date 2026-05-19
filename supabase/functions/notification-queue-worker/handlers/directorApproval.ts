// Handler: director_approval
// Notificação consolidada para diretores quando pagamento entra em aguardando_aprovacao.
// Envia e-mail HTML (template cobre/bronze MedPay/DF Star) + WhatsApp.

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";
const EMAIL_FROM = "MedPay <onboarding@resend.dev>";

const greetingForBrazil = (now = new Date()) => {
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
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(n as number);
};

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function buildEmailText(
  greeting: string,
  name: string,
  paymentRef: string,
  totalFormatted: string,
  companyCount: number,
  link: string,
): string {
  return `${greeting}, ${name}.

Há um pagamento aguardando sua aprovação no MedPay.

Pagamento: ${paymentRef}
Valor total: ${totalFormatted}
Empresas: ${companyCount}

Acessar: ${link}

—
MedPay · Hospital DF Star · Rede D'Or
Você está recebendo este e-mail porque é um diretor aprovador no MedPay.`;
}

function buildEmailHtml(
  greeting: string,
  name: string,
  paymentRef: string,
  totalFormatted: string,
  companyCount: number,
  link: string,
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Pagamento aguardando aprovação — MedPay</title>
</head>
<body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EFE8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;border:0.5px solid #D3D1C7;">
        <tr><td style="background:#9A6B3A;padding:24px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size:18px;font-weight:500;color:#FFFFFF;letter-spacing:0.3px;">MedPay</td>
              <td align="right" style="font-size:12px;color:rgba(255,255,255,0.75);">Hospital DF Star</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:16px;color:#2C2C2A;margin:0 0 8px;">${greeting}, Prezado(a) ${escapeHtml(name)}.</p>
          <p style="font-size:14px;color:#5F5E5A;margin:0 0 24px;line-height:1.6;">Há um pagamento aguardando sua aprovação no MedPay.</p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EFE8;border-radius:10px;margin:0 0 28px;">
            <tr><td style="padding:20px;">
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
            </td></tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td align="center" style="padding:0 0 28px;">
              <a href="${link}" style="display:inline-block;background:#9A6B3A;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Acessar no MedPay</a>
            </td></tr>
          </table>

          <p style="font-size:12px;color:#888780;margin:0;text-align:center;line-height:1.6;">Você está recebendo este e-mail porque é um diretor aprovador no MedPay.</p>
        </td></tr>
        <tr><td style="background:#F1EFE8;padding:16px 32px;text-align:center;border-top:0.5px solid #D3D1C7;">
          <p style="font-size:11px;color:#888780;margin:0;">MedPay · Hospital DF Star · Rede D'Or</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWhatsappDirector(
  greeting: string,
  name: string,
  paymentRef: string,
  companyCount: number,
  totalFormatted: string,
  link: string,
): string {
  const empresasLabel = companyCount === 1 ? "empresa" : "empresas";
  return `${greeting}, Prezado(a) ${name}.

*MedPay — DF Star*
Pagamento "${paymentRef}" aguarda sua aprovação.
${totalFormatted} · ${companyCount} ${empresasLabel}

Acessar: ${link}`;
}

// deno-lint-ignore no-explicit-any
export async function processDirectorApproval(supabase: any, row: any): Promise<{ ok: boolean; meta: unknown }> {
  const { data: payment } = await supabase
    .from("payments")
    .select("id, reference, total_amount, status")
    .eq("id", row.payment_id)
    .maybeSingle();
  if (!payment) return { ok: true, meta: { error: "payment_not_found" } };

  const { count: companyCount } = await supabase
    .from("payment_company_groups")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", payment.id);
  const companies = companyCount ?? 0;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "diretor");
  const directorIds = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id)));
  if (directorIds.length === 0) {
    return { ok: true, meta: { skipped: "no_directors" } };
  }

  const { data: directors } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .in("id", directorIds);

  const link = `${APP_BASE_URL}/pagamentos/${payment.id}`;
  const greeting = greetingForBrazil();
  const totalFormatted = brl(payment.total_amount);

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

  // deno-lint-ignore no-explicit-any
  const emailResults: any[] = [];
  // deno-lint-ignore no-explicit-any
  const whatsappResults: any[] = [];

  for (const d of directors ?? []) {
    const name = firstName(d.full_name);

    // Email
    if (d.email && LOVABLE_API_KEY && RESEND_API_KEY) {
      const html = buildEmailHtml(greeting, name, payment.reference, totalFormatted, companies, link);
      const text = buildEmailText(greeting, name, payment.reference, totalFormatted, companies, link);
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

    // WhatsApp
    const phoneDigits = onlyDigits(d.phone ?? "");
    if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
      const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
      const waBody = buildWhatsappDirector(greeting, name, payment.reference, companies, totalFormatted, link);
      const params = new URLSearchParams({
        To: `whatsapp:${e164}`,
        From: TWILIO_FROM,
        Body: waBody,
      });
      try {
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

  const emailsOk = emailResults.filter((x) => x.ok).length;
  const whatsOk = whatsappResults.filter((x) => x.ok).length;

  const obsMsg = `Notificação consolidada para diretores: pagamento aguarda aprovação (${totalFormatted}, ${companies} empresa(s)). ${emailsOk}/${emailResults.length} e-mail(s) e ${whatsOk}/${whatsappResults.length} WhatsApp(s) enviado(s).`;
  await supabase.from("payment_observations").insert({
    payment_id: payment.id,
    author_type: "sistema",
    message: obsMsg,
  });

  return {
    ok: true,
    meta: {
      emails_ok: emailsOk,
      emails_total: emailResults.length,
      whatsapp_ok: whatsOk,
      whatsapp_total: whatsappResults.length,
      companies,
      total_value: Number(payment.total_amount ?? 0),
      directors_count: (directors ?? []).length,
    },
  };
}
