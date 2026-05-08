// Notifica todos os validadores ativos quando o analista envia um lote/empresa
// para validação. A validação é fila coletiva — qualquer validador pode assumir.
// Também registra no audit_log e cria uma observação no histórico do pagamento.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
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
  (full ?? "").trim().split(/\s+/)[0] || "Validador(a)";

const fmtBR = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

interface Body {
  payment_id: string;
  /** Id do payment_company_groups envolvido. Se omitido, registra apenas auditoria a nível de pagamento. */
  group_id?: string | null;
  /** Quem fez o envio (analista). */
  sender_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.payment_id) {
      return new Response(JSON.stringify({ error: "payment_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pagamento
    const { data: payment } = await supabase
      .from("payments")
      .select("id, reference, total_amount, items_count")
      .eq("id", body.payment_id)
      .maybeSingle();
    if (!payment) {
      return new Response(JSON.stringify({ error: "pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Empresa (se houver)
    let companyName: string | null = null;
    let companyId: string | null = null;
    if (body.group_id) {
      const { data: g } = await supabase
        .from("payment_company_groups")
        .select("id, company_name, company_id")
        .eq("id", body.group_id)
        .maybeSingle();
      companyName = g?.company_name ?? null;
      companyId = g?.company_id ?? null;
    }

    // Destinatários: todos os validadores ativos (fila coletiva).
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "validador");
    const recipientIds = Array.from(new Set((roles ?? []).map((r) => r.user_id)));

    let recipients: { id: string; full_name: string | null; email: string }[] = [];
    if (recipientIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", recipientIds);
      recipients = (profs ?? []) as typeof recipients;
    }

    // Quem enviou (para o corpo do email e auditoria)
    let senderName: string | null = null;
    if (body.sender_id) {
      const { data: s } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", body.sender_id)
        .maybeSingle();
      senderName = s?.full_name ?? s?.email ?? null;
    }

    const sentAt = new Date().toISOString();
    const link = `${APP_BASE_URL}/pagamentos/${payment.id}`;
    const greeting = greetingForBrazil();

    // Envia emails
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const emailResults: unknown[] = [];

    for (const r of recipients) {
      if (!r.email || !LOVABLE_API_KEY || !RESEND_API_KEY) {
        emailResults.push({ recipient_id: r.id, ok: false, skipped: "missing_email_or_keys" });
        continue;
      }
      const name = firstName(r.full_name);
      const lines = [
        `${greeting}, ${name}.`,
        ``,
        `Um lote foi enviado para validação no MedPay${
          companyName ? ` — empresa ${companyName}` : ""
        }.`,
        `• Lote: ${payment.reference}`,
        `• Itens: ${payment.items_count}`,
        senderName ? `• Enviado por: ${senderName}` : null,
        `• Data/hora: ${fmtBR(sentAt)}`,
        ``,
        `Qualquer validador pode assumir.`,
        `Acessar: ${link}`,
      ].filter(Boolean) as string[];
      const text = lines.join("\n");
      const html = `<p>${text.replace(/\n/g, "<br/>")}</p>`;
      try {
        const resp = await fetch(`${RESEND_GATEWAY}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [r.email],
            subject: `Novo lote para validação${companyName ? ` — ${companyName}` : ""}`,
            html,
            text,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        emailResults.push({ recipient_id: r.id, ok: resp.ok, status: resp.status, response: j });
      } catch (e) {
        emailResults.push({ recipient_id: r.id, ok: false, error: String(e) });
      }
    }

    // Registra na auditoria
    const diff = {
      payment: {
        reference: payment.reference,
        items_count: payment.items_count,
        total_amount: payment.total_amount,
      },
      group: body.group_id ? { id: body.group_id, company_name: companyName } : null,
      sender: body.sender_id ? { id: body.sender_id, name: senderName } : null,
      recipients: recipients.map((r) => ({
        id: r.id,
        name: r.full_name ?? r.email,
        email: r.email,
      })),
      sent_at: sentAt,
      email_results_summary: emailResults.map((x: any) => ({
        recipient_id: x.recipient_id,
        ok: !!x.ok,
      })),
    };

    await supabase.from("audit_log").insert({
      actor_id: body.sender_id ?? null,
      entity_type: "payment_company_group",
      entity_id: body.group_id ?? body.payment_id,
      action: "validation_assigned",
      diff,
      company_id: companyId,
      company_name: companyName,
    });

    // Também registra como observação no histórico do pagamento (visível na UI)
    const okCount = emailResults.filter((x: any) => x.ok).length;
    const obsMsg =
      `Notificação de envio para validação (fila coletiva). ` +
      `${okCount}/${emailResults.length} email(s) enviados aos validadores. ` +
      `Em ${fmtBR(sentAt)}.`;

    await supabase.from("payment_observations").insert({
      payment_id: payment.id,
      author_type: "sistema",
      message: obsMsg,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        recipients: recipients.length,
        email_results: emailResults,
        sent_at: sentAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-validator-assignment error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
