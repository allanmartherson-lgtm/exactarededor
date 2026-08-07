import { sendCorporateEmail } from "../../_shared/sendCorporateEmail.ts";

// Handler: director_reapproval
// Notifica diretores quando UM grupo de empresa (já aprovado) sofreu alteração
// relevante e precisa de novo "de acordo". Mostra diff antes vs depois e
// dispara magic link com action=approve_reapproval.

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const TWILIO_FROM = "whatsapp:+14155238886";
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
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const triggerLabel = (src: string | null | undefined) => {
  switch (src) {
    case "company_change_source": return "Troca de empresa (origem)";
    case "company_change_destination": return "Troca de empresa (destino)";
    case "invoice_pendency": return "Pendência sinalizada pela empresa";
    default: return "Ajuste do analista";
  }
};

// deno-lint-ignore no-explicit-any
export async function processDirectorReapproval(supabase: any, row: any): Promise<{ ok: boolean; meta: unknown }> {
  const ev = row.event ?? row.payload ?? {};
  const companyGroupId: string | undefined = ev.company_group_id;
  if (!companyGroupId) return { ok: true, meta: { error: "missing_company_group_id" } };

  const { data: group } = await supabase
    .from("payment_company_groups")
    .select("id, payment_id, company_name, bruto_total, liquido_total, last_approved_bruto, last_approved_liquido, reapproval_pending, reapproval_trigger_source, reapproval_reason, hospital_id")
    .eq("id", companyGroupId)
    .maybeSingle();
  if (!group) return { ok: true, meta: { error: "group_not_found" } };
  if (!group.reapproval_pending) return { ok: true, meta: { skipped: "no_longer_pending" } };

  const { data: payment } = await supabase
    .from("payments")
    .select("id, reference")
    .eq("id", group.payment_id)
    .maybeSingle();
  const paymentRef = payment?.reference ?? group.payment_id;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "diretor");
  const directorIds = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id)));
  if (directorIds.length === 0) return { ok: true, meta: { skipped: "no_directors" } };

  const { data: directors } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .in("id", directorIds);

  const link = `${APP_BASE_URL}/pagamentos/${group.payment_id}?grupo=${group.id}`;
  const greeting = greetingForBrazil();
  const brutoBefore = brl(group.last_approved_bruto ?? 0);
  const brutoAfter = brl(group.bruto_total ?? 0);
  const liqBefore = brl(group.last_approved_liquido ?? 0);
  const liqAfter = brl(group.liquido_total ?? 0);
  const delta = Number(group.bruto_total ?? 0) - Number(group.last_approved_bruto ?? 0);
  const deltaLabel = (delta >= 0 ? "+" : "") + brl(delta);
  const reasonTxt = group.reapproval_reason ? `\nMotivo: ${group.reapproval_reason}` : "";
  const trigger = triggerLabel(group.reapproval_trigger_source);

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

  // deno-lint-ignore no-explicit-any
  const emailResults: any[] = [];
  // deno-lint-ignore no-explicit-any
  const whatsappResults: any[] = [];

  for (const d of directors ?? []) {
    const name = firstName(d.full_name);

    const html = `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2C2C2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EFE8;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:0.5px solid #D3D1C7;">
<tr><td style="background:#B45309;padding:24px 32px;color:#FFF;">
  <div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;opacity:.85;">RE-APROVAÇÃO necessária</div>
  <div style="font-size:18px;font-weight:600;margin-top:4px;">Exacta · ${escapeHtml(group.company_name ?? "")}</div>
</td></tr>
<tr><td style="padding:32px;">
  <p style="font-size:16px;margin:0 0 8px;">${greeting}, Prezado(a) ${escapeHtml(name)}.</p>
  <p style="font-size:14px;color:#5F5E5A;line-height:1.6;margin:0 0 24px;">O grupo da empresa <strong>${escapeHtml(group.company_name ?? "")}</strong> no pagamento <strong>${escapeHtml(paymentRef)}</strong> sofreu alteração após sua aprovação anterior e precisa de novo "de acordo".</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;margin:0 0 24px;">
    <tr><td style="padding:16px;">
      <div style="font-size:11px;color:#9A3412;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Motivo</div>
      <div style="font-size:14px;color:#7C2D12;margin-top:4px;">${escapeHtml(trigger)}${group.reapproval_reason ? " — " + escapeHtml(group.reapproval_reason) : ""}</div>
    </td></tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EFE8;border-radius:10px;margin:0 0 24px;">
    <tr><td style="padding:20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:11px;color:#888780;text-transform:uppercase;letter-spacing:.5px;padding-bottom:6px;">&nbsp;</td>
          <td style="font-size:11px;color:#888780;text-transform:uppercase;letter-spacing:.5px;padding-bottom:6px;">Antes</td>
          <td style="font-size:11px;color:#888780;text-transform:uppercase;letter-spacing:.5px;padding-bottom:6px;">Depois</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#5F5E5A;padding:6px 0;">Bruto</td>
          <td style="font-size:14px;color:#2C2C2A;padding:6px 0;">${brutoBefore}</td>
          <td style="font-size:14px;color:#2C2C2A;font-weight:600;padding:6px 0;">${brutoAfter}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#5F5E5A;padding:6px 0;">Líquido</td>
          <td style="font-size:14px;color:#2C2C2A;padding:6px 0;">${liqBefore}</td>
          <td style="font-size:14px;color:#2C2C2A;font-weight:600;padding:6px 0;">${liqAfter}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#5F5E5A;padding:6px 0;border-top:1px solid #D3D1C7;">Δ Bruto</td>
          <td colspan="2" style="font-size:14px;color:${delta >= 0 ? "#9A3412" : "#15803D"};font-weight:600;padding:6px 0;border-top:1px solid #D3D1C7;">${deltaLabel}</td>
        </tr>
      </table>
    </td></tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 28px;">
    <a href="${link}" style="display:inline-block;background:#B45309;color:#FFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Analisar e re-aprovar</a>
  </td></tr></table>

  <p style="font-size:12px;color:#888780;margin:0;text-align:center;line-height:1.6;">Apenas este grupo precisa de nova aprovação. Os demais grupos do pagamento seguem inalterados.</p>
</td></tr></table>
</td></tr></table></body></html>`;

    const text = `${greeting}, ${name}.

RE-APROVAÇÃO necessária — Exacta
Empresa: ${group.company_name}
Pagamento: ${paymentRef}
Motivo: ${trigger}${reasonTxt}

Bruto: ${brutoBefore} → ${brutoAfter} (Δ ${deltaLabel})
Líquido: ${liqBefore} → ${liqAfter}

Acessar: ${link}`;

    if (d.email) {
      const res = await sendCorporateEmail({
        to: d.email,
        subject: `Re-aprovação: ${group.company_name} (${paymentRef}) — Δ ${deltaLabel}`,
        html,
        text,
        user_id: d.id,
        event_key: "director_reapproval",
        template_key: "director_reapproval",
      });
      emailResults.push({ director_id: d.id, ok: res.ok, status: res.status, response: res.response });
    } else {
      emailResults.push({ director_id: d.id, ok: false, skipped: "missing_email" });
    }

    const phoneDigits = onlyDigits(d.phone ?? "");
    if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY) {
      const e164 = phoneDigits.length === 11 ? `+55${phoneDigits}` : `+${phoneDigits}`;
      const waBody = `${greeting}, ${name}.

*Exacta — RE-APROVAÇÃO*
${group.company_name} · ${paymentRef}
Bruto: ${brutoBefore} → ${brutoAfter} (Δ ${deltaLabel})

Acessar: ${link}`;
      const params = new URLSearchParams({ To: `whatsapp:${e164}`, From: TWILIO_FROM, Body: waBody });
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
        const j = await r.json().catch(() => ({}));
        whatsappResults.push({ director_id: d.id, ok: r.ok, status: r.status, response: j });
      } catch (e) {
        whatsappResults.push({ director_id: d.id, ok: false, error: String(e) });
      }
    } else {
      whatsappResults.push({ director_id: d.id, ok: false, skipped: "missing_phone_or_keys" });
    }
  }

  const emailsOk = emailResults.filter((x) => x.ok).length;
  const whatsOk = whatsappResults.filter((x) => x.ok).length;

  await supabase.from("payment_observations").insert({
    payment_id: group.payment_id,
    author_type: "sistema",
    message: `[${group.company_name}] Notificação de RE-APROVAÇÃO enviada aos diretores (${trigger}, Δ ${deltaLabel}). ${emailsOk}/${emailResults.length} e-mail(s), ${whatsOk}/${whatsappResults.length} WhatsApp.`,
    metadata: { company_group_id: group.id, kind: "director_reapproval" },
  });

  return {
    ok: true,
    meta: {
      company_group_id: group.id,
      emails_ok: emailsOk,
      emails_total: emailResults.length,
      whatsapp_ok: whatsOk,
      whatsapp_total: whatsappResults.length,
      delta,
    },
  };
}
