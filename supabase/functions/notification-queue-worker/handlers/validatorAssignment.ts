// Handler: validator_assignment
// Consolida múltiplas notificações de envio para validação em um único e-mail
// e registra observação no histórico do pagamento.

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";
const EMAIL_FROM = "MedPay <onboarding@resend.dev>";

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

*MedPay — DF Star*
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

${companyCount} ${companyCount === 1 ? "empresa foi enviada" : "empresas foram enviadas"} para validação no MedPay, totalizando ${totalFormatted}.

Pagamento: ${paymentRef}
${lista}${extraLine}${sender}

Qualquer validador pode assumir.
Acessar: ${link}

—
MedPay · Hospital DF Star · Rede D'Or`;
}

function buildHtml(
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

  const empresasRows = top5.map((g) => `
    <tr>
      <td style="padding:8px 0;border-bottom:0.5px solid #E0DED5;">
        <p style="font-size:14px;color:#2C2C2A;margin:0 0 2px;">${escapeHtml(g.company_name)}</p>
        <p style="font-size:12px;color:#888780;margin:0;">${g.items_count} itens</p>
      </td>
      <td style="padding:8px 0;border-bottom:0.5px solid #E0DED5;text-align:right;">
        <p style="font-size:14px;color:#2C2C2A;margin:0;font-weight:500;">${brl(g.total_amount)}</p>
      </td>
    </tr>`).join("");

  const extraRow = extra > 0 ? `
    <tr><td colspan="2" style="padding:12px 0 0;text-align:center;">
      <p style="font-size:12px;color:#888780;margin:0;font-style:italic;">e mais ${extra} empresa(s)</p>
    </td></tr>` : "";

  const senderBlock = senderNames.length > 0 ? `
    <p style="font-size:12px;color:#888780;margin:16px 0 0;">
      Enviado por: ${senderNames.map(escapeHtml).join(", ")}
    </p>` : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${companyCount} empresa(s) para validação — MedPay</title>
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
          <p style="font-size:14px;color:#5F5E5A;margin:0 0 24px;line-height:1.6;">
            ${companyCount} ${companyCount === 1 ? "empresa foi enviada" : "empresas foram enviadas"} para validação no MedPay, totalizando <strong style="color:#2C2C2A;">${totalFormatted}</strong>.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EFE8;border-radius:10px;margin:0 0 28px;">
            <tr><td style="padding:20px;">
              <p style="font-size:11px;color:#888780;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Pagamento</p>
              <p style="font-size:16px;color:#2C2C2A;margin:0 0 18px;font-weight:500;">${escapeHtml(paymentRef)}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="50%" style="vertical-align:top;padding-right:8px;">
                    <p style="font-size:11px;color:#888780;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Valor total</p>
                    <p style="font-size:18px;color:#2C2C2A;margin:0;font-weight:500;">${totalFormatted}</p>
                  </td>
                  <td width="50%" style="vertical-align:top;">
                    <p style="font-size:11px;color:#888780;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Empresas</p>
                    <p style="font-size:18px;color:#2C2C2A;margin:0;font-weight:500;">${companyCount}</p>
                  </td>
                </tr>
              </table>

              <p style="font-size:11px;color:#888780;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Empresas enviadas</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${empresasRows}
                ${extraRow}
              </table>

              ${senderBlock}
            </td></tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td align="center" style="padding:0 0 28px;">
              <a href="${link}" style="display:inline-block;background:#9A6B3A;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Acessar no MedPay</a>
            </td></tr>
          </table>

          <p style="font-size:12px;color:#888780;margin:0;text-align:center;line-height:1.6;">Qualquer validador pode assumir. Você está recebendo este e-mail porque é um validador no MedPay.</p>
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
    .select("id, full_name, email")
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
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    // Faltam keys de e-mail — marca como enviado para não loop infinito
    return { ok: true, meta: { error: "missing_email_keys" } };
  }

  // deno-lint-ignore no-explicit-any
  const results: any[] = [];
  for (const p of profiles ?? []) {
    if (!p.email) {
      results.push({ recipient_id: p.id, ok: false, skipped: "no_email" });
      continue;
    }
    const name = firstName(p.full_name);
    const html = buildHtml(greeting, name, payment.reference, uniqueGroups, companyCount, totalFormatted, senderNames, link);
    const text = buildText(greeting, name, payment.reference, uniqueGroups, companyCount, totalFormatted, senderNames, link);

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
          to: [p.email],
          subject: `${companyCount} ${companyCount === 1 ? "empresa enviada" : "empresas enviadas"} para validação — ${payment.reference}`,
          html,
          text,
        }),
      });
      const json = await r.json().catch(() => ({}));
      results.push({ recipient_id: p.id, ok: r.ok, status: r.status, response: json });
    } catch (e) {
      results.push({ recipient_id: p.id, ok: false, error: String(e) });
    }
  }

  const okCount = results.filter((x) => x.ok).length;
  const failCount = results.length - okCount;

  // Se TODOS falharam por erro de rede, levanta para retry (não marca sent_at)
  if (okCount === 0 && failCount > 0 && results.every((x) => x.error)) {
    throw new Error(`all_email_sends_failed: ${JSON.stringify(results.slice(0, 2))}`);
  }

  const obsMsg = `Notificação consolidada de envio para validação: ${companyCount} empresa(s) totalizando ${totalFormatted}. ${okCount}/${results.length} e-mail(s) enviado(s) aos validadores.`;
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
      companies: companyCount,
      total_value: consolidatedTotal,
      events_count: events.length,
      unique_companies_count: uniqueGroupsMap.size,
      recipients_count: (profiles ?? []).length,
    },
  };
}
