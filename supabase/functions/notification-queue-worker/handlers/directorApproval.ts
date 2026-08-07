// Handler: director_approval
// Notificação consolidada para diretores quando pagamento entra em aguardando_aprovacao.
// Envia e-mail HTML (template e1) + WhatsApp.

import { e1_productionValidation } from "../../_shared/emailTemplates/templates.ts";
import { sendCorporateEmail } from "../../_shared/sendCorporateEmail.ts";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";


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

Há um pagamento aguardando sua aprovação no Exacta.

Pagamento: ${paymentRef}
Valor total: ${totalFormatted}
Empresas: ${companyCount}

Acessar: ${link}

—
Exacta · Hospital DF Star · Rede D'Or
Você está recebendo este e-mail porque é um diretor aprovador no Exacta.`;
}

// (HTML antigo removido — usa e1_productionValidation do módulo compartilhado)



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

*Exacta — DF Star*
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
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

  // deno-lint-ignore no-explicit-any
  const emailResults: any[] = [];
  // deno-lint-ignore no-explicit-any
  const whatsappResults: any[] = [];

  for (const d of directors ?? []) {
    const name = firstName(d.full_name);

    // Email
    if (d.email) {
      const rendered = e1_productionValidation({
        director_name: name,
        payment_reference: payment.reference,
        payment_type: null,
        competence_month: null,
        hospital_name: null,
        company_count: companies,
        total_value: totalFormatted,
        approve_link: link,
        reject_link: null,
      });
      const res = await sendCorporateEmail({
        to: d.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        user_id: d.id,
        payment_id: payment.id,
        event_key: "director_approval",
        template_key: "e1_production_validation",
      });
      emailResults.push({ director_id: d.id, ok: res.ok, status: res.status, response: res.response });
    } else {
      emailResults.push({ director_id: d.id, ok: false, skipped: "missing_email" });
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
