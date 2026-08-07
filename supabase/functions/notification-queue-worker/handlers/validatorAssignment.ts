// Handler: validator_assignment
// Consolida múltiplas notificações de envio para validação em um único e-mail
// e registra observação no histórico do pagamento.

import { b1_validatorAssignment } from "../../_shared/emailTemplates/templates.ts";
import { sendCorporateEmail } from "../../_shared/sendCorporateEmail.ts";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";


const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

function buildWhatsappValidator(
  greeting: string,
  name: string,
  paymentRef: string,
  companyCount: number,
  totalFormatted: string,
  link: string,
): string {
  const empresasLabel = companyCount === 1 ? "empresa" : "empresas";
  return `${greeting}, ${name}.

*Exacta — DF Star*
${companyCount} ${empresasLabel} para validação no lote "${paymentRef}".
Total: ${totalFormatted}

Acessar: ${link}`;
}

const greetingForBrazil = (now = new Date()) => {
  const brHour = (now.getUTCHours() - 3 + 24) % 24;
  if (brHour >= 5 && brHour < 12) return "Bom dia";
  if (brHour >= 12 && brHour < 18) return "Boa tarde";
  return "Boa noite";
};

const firstName = (full?: string | null) =>
  (full ?? "").trim().split(/\s+/)[0] || "Validador(a)";

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

interface CompanyGroup {
  company_name: string;
  total_amount: number;
  items_count: number;
}

function buildText(
  greeting: string,
  name: string,
  paymentRef: string,
  groups: CompanyGroup[],
  companyCount: number,
  totalFormatted: string,
  senderNames: string[],
  link: string,
): string {
  const top5 = groups.slice(0, 5);
  const extra = Math.max(0, companyCount - 5);
  const lista = top5
    .map((g) => `• ${g.company_name} — ${brl(g.total_amount)} (${g.items_count} itens)`)
    .join("\n");
  const extraLine = extra > 0 ? `\n• e mais ${extra} empresa(s)` : "";
  const sender = senderNames.length > 0 ? `\n\nEnviado por: ${senderNames.join(", ")}` : "";

  return `${greeting}, Prezado(a) ${name}.

${companyCount} ${companyCount === 1 ? "empresa foi enviada" : "empresas foram enviadas"} para validação no Exacta, totalizando ${totalFormatted}.

Pagamento: ${paymentRef}
${lista}${extraLine}${sender}

Qualquer validador pode assumir.
Acessar: ${link}

—
Exacta · Hospital DF Star · Rede D'Or`;
}

// (HTML antigo removido — agora usa b1_validatorAssignment do módulo compartilhado)


// deno-lint-ignore no-explicit-any
export async function processValidatorAssignment(supabase: any, row: any): Promise<{ ok: boolean; meta: unknown }> {
  const { data: payment } = await supabase
    .from("payments")
    .select("id, reference, total_amount")
    .eq("id", row.payment_id)
    .maybeSingle();
  if (!payment) return { ok: true, meta: { error: "payment_not_found" } };

  const events = Array.isArray(row.events) ? row.events : [];
  const uniqueGroupsMap = new Map<string, CompanyGroup>();
  for (const e of events) {
    const key = e?.group_id ?? `__no_group__${uniqueGroupsMap.size}`;
    if (!uniqueGroupsMap.has(key)) {
      uniqueGroupsMap.set(key, {
        company_name: e?.company_name ?? "(sem nome)",
        total_amount: Number(e?.total_amount ?? 0),
        items_count: Number(e?.items_count ?? 0),
      });
    }
  }
  const uniqueGroups = Array.from(uniqueGroupsMap.values());
  const companyCount = uniqueGroups.length;
  const consolidatedTotal = uniqueGroups.reduce((sum, g) => sum + g.total_amount, 0);

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "validador");
  const recipientIds = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id)));
  if (recipientIds.length === 0) {
    return { ok: true, meta: { skipped: "no_validators", events_count: events.length } };
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .in("id", recipientIds);

  let senderNames: string[] = [];
  if (Array.isArray(row.sender_ids) && row.sender_ids.length > 0) {
    const { data: senders } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", row.sender_ids);
    senderNames = (senders ?? [])
      .map((s: { full_name: string | null }) => s.full_name || "Analista");
  }

  const link = `${APP_BASE_URL}/pagamentos/${payment.id}`;
  const greeting = greetingForBrazil();
  const totalFormatted = brl(consolidatedTotal);

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  // deno-lint-ignore no-explicit-any
  const results: any[] = [];
  for (const p of profiles ?? []) {
    if (!p.email) {
      results.push({ recipient_id: p.id, ok: false, skipped: "no_email" });
      continue;
    }
    const name = firstName(p.full_name);
    const rendered = b1_validatorAssignment({
      validator_name: name,
      payment_reference: payment.reference,
      payment_type: null,
      competence_month: null,
      hospital_name: null,
      company_count: companyCount,
      payment_link: link,
    });
    const senderSuffix = senderNames.length > 0 ? ` (enviado por ${senderNames.join(", ")})` : "";

    const res = await sendCorporateEmail({
      to: p.email,
      subject: `${rendered.subject}${senderSuffix}`,
      html: rendered.html,
      text: rendered.text + (senderSuffix ? `\n${senderSuffix.trim()}` : ""),
      user_id: p.id,
      payment_id: payment.id,
      event_key: "validator_assignment",
      template_key: "b1_validator_assignment",
    });
    results.push({
      recipient_id: p.id,
      ok: res.ok,
      status: res.status,
      response: res.response,
      ...(res.ok ? {} : { error: res.error }),
    });
  }

  const okCount = results.filter((x) => x.ok).length;
  const failCount = results.length - okCount;

  // Se TODOS falharam por erro de rede, levanta para retry (não marca sent_at)
  if (okCount === 0 && failCount > 0 && results.every((x) => x.error)) {
    throw new Error(`all_email_sends_failed: ${JSON.stringify(results.slice(0, 2))}`);
  }

  // WhatsApp consolidado para validadores
  // deno-lint-ignore no-explicit-any
  const whatsappResults: any[] = [];
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

  if (LOVABLE_API_KEY && TWILIO_API_KEY) {
    for (const p of profiles ?? []) {
      const phoneDigits = onlyDigits(p.phone ?? "");
      if (!phoneDigits) {
        whatsappResults.push({ recipient_id: p.id, ok: false, skipped: "no_phone" });
        continue;
      }
      const name = firstName(p.full_name);
      const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
      const waBody = buildWhatsappValidator(greeting, name, payment.reference, companyCount, totalFormatted, link);
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
        whatsappResults.push({ recipient_id: p.id, ok: r.ok, status: r.status, response: json });
      } catch (e) {
        whatsappResults.push({ recipient_id: p.id, ok: false, error: String(e) });
      }
    }
  } else {
    for (const p of profiles ?? []) {
      whatsappResults.push({ recipient_id: p.id, ok: false, skipped: "missing_twilio_keys" });
    }
  }

  const whatsOkCount = whatsappResults.filter((x) => x.ok).length;

  const obsMsg = `Notificação consolidada de envio para validação: ${companyCount} empresa(s) totalizando ${totalFormatted}. ${okCount}/${results.length} e-mail(s) e ${whatsOkCount}/${whatsappResults.length} WhatsApp(s) enviado(s) aos validadores.`;
  await supabase.from("payment_observations").insert({
    payment_id: payment.id,
    author_type: "sistema",
    message: obsMsg,
  });

  return {
    ok: true,
    meta: {
      emails_ok: okCount,
      emails_total: results.length,
      whatsapp_ok: whatsOkCount,
      whatsapp_total: whatsappResults.length,
      companies: companyCount,
      total_value: consolidatedTotal,
      events_count: events.length,
      unique_companies_count: uniqueGroupsMap.size,
      recipients_count: (profiles ?? []).length,
    },
  };
}
