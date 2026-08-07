
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import {
  a2_nfReceived,
  b2_iaConcluded,
  b3_returned,
} from "../_shared/emailTemplates/templates.ts";
import { sendCorporateEmail } from "../_shared/sendCorporateEmail.ts";
import { APP_URL } from "../_shared/appUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const APP_BASE_URL = APP_URL;
const TWILIO_FROM = "whatsapp:+14155238886"; // Twilio Sandbox

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

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

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

    // Busca as preferências de notificação do analista
    const { data: settings } = await supabase
      .from("user_notification_settings")
      .select("email_enabled, whatsapp_enabled")
      .eq("user_id", payment.created_by)
      .eq("event_type", eventType)
      .maybeSingle();

    const emailEnabled = settings ? settings.email_enabled : true;
    const whatsappEnabled = settings ? settings.whatsapp_enabled : true;

    if (!emailEnabled && !whatsappEnabled) {
      return new Response(JSON.stringify({ ok: true, message: "Notificações desativadas para este evento" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const link = `${APP_BASE_URL}/pagamentos/${paymentId}`;
    const greeting = greetingForBrazil();
    const name = firstName(analyst.full_name);
    const reference = payment.reference ?? paymentId.slice(0, 8);

    let subject = "";
    let bodyText = "";
    let html = "";

    switch (eventType) {
      case "returned": {
        const r = b3_returned({
          analyst_name: name,
          payment_reference: reference,
          returned_by: actorName ?? null,
          returned_at: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
          return_reason: reason ?? null,
          payment_link: link,
        });
        subject = r.subject; html = r.html; bodyText = r.text;
        break;
      }
      case "ia_concluded": {
        // Bug (08/2026): estes indicadores eram enviados como "—" fixo e o
        // `reason` (texto de progresso) ia no lugar do tempo de análise.
        // Agora buscamos os números reais do lote no momento do envio.
        const countItems = async (filter?: (q: any) => any) => {
          let q = supabase
            .from("payment_items")
            .select("id", { count: "exact", head: true })
            .eq("payment_id", paymentId);
          if (filter) q = filter(q);
          const { count, error } = await q;
          if (error) {
            console.error("count payment_items error", error);
            return null;
          }
          return count ?? 0;
        };

        const [itemsCount, alertsCount, divergencesCount] = await Promise.all([
          countItems(),
          countItems((q) => q.eq("ai_status", "alerta")),
          countItems((q) => q.eq("ai_status", "reprovado")),
        ]);

        // Tempo de análise: derivado do job de processamento mais recente.
        let duration: string | null = null;
        const { data: job } = await supabase
          .from("payment_processing_jobs")
          .select("started_at, finished_at")
          .eq("payment_id", paymentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (job?.started_at && job?.finished_at) {
          const ms = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
          if (Number.isFinite(ms) && ms >= 0) {
            const totalSec = Math.round(ms / 1000);
            const min = Math.floor(totalSec / 60);
            const sec = totalSec % 60;
            duration = min > 0 ? `${min} min ${sec}s` : `${sec}s`;
          }
        }

        const r = b2_iaConcluded({
          analyst_name: name,
          payment_reference: reference,
          items_count: itemsCount,
          alerts_count: alertsCount,
          divergences_count: divergencesCount,
          analysis_duration: duration,
          payment_link: link,
        });
        subject = r.subject; html = r.html; bodyText = r.text;
        break;
      }
      case "nf_received": {
        const r = a2_nfReceived({
          analyst_name: name,
          company_name: actorName || "empresa",
          company_cnpj: null,
          invoice_value: "—",
          competence_month: null,
          payment_reference: reference,
          invoice_link: link,
        });
        subject = r.subject; html = r.html; bodyText = r.text;
        // Quando a chegada exige atenção (divergência / revisão manual), o
        // motivo escrito pelo motor entra no corpo do e-mail.
        if (reason) {
          subject = `[Atenção] ${subject}`;
          html += `<p style="margin:16px 0;padding:12px;border-left:4px solid #C6A27C;background:#FAF6F0;">
            <strong>Motivo:</strong> ${String(reason).replace(/</g, "&lt;")}
          </p>`;
          bodyText += `\n\nMotivo: ${reason}`;
        }
        break;
      }
    }


    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");

    const emailResults: unknown[] = [];
    const whatsappResults: unknown[] = [];

    // Email via mailbox corporativo (send-email-corporate)
    if (analyst.email && emailEnabled) {
      const res = await sendCorporateEmail({
        to: analyst.email,
        subject,
        html,
        text: bodyText,
        user_id: analyst.id,
        payment_id: paymentId,
        event_key: `analyst_event_${eventType}`,
        template_key: `analyst_event_${eventType}`,
      });
      emailResults.push({ ok: res.ok, status: res.status, response: res.response });
    }

    // WhatsApp
    const phoneDigits = onlyDigits(analyst.phone ?? "");
    if (phoneDigits && LOVABLE_API_KEY && TWILIO_API_KEY && whatsappEnabled) {
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
