// Envia notificação ao analista criador quando o supervisor aprova ou rejeita uma campanha.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";

interface Body {
  campaign_id: string;
  decision: "approved" | "rejected";
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const { campaign_id, decision, reason } = (await req.json()) as Body;
    if (!campaign_id || !decision || (decision !== "approved" && decision !== "rejected")) {
      return new Response(JSON.stringify({ error: "campaign_id e decision (approved|rejected) são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: camp } = await supabase
      .from("comm_campaigns")
      .select("id, title, created_by, approved_by, approved_at, rejection_reason")
      .eq("id", campaign_id)
      .maybeSingle();

    if (!camp?.created_by) {
      return new Response(JSON.stringify({ ok: true, skipped: "no creator" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: analyst } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", camp.created_by)
      .maybeSingle();

    const { data: supervisor } = camp.approved_by
      ? await supabase.from("profiles").select("full_name").eq("id", camp.approved_by).maybeSingle()
      : { data: null };

    const url = `${APP_BASE_URL}/comunicacao/massa`;
    const supName = (supervisor as { full_name?: string } | null)?.full_name ?? "Supervisor";
    const title = camp.title ?? "(sem título)";
    const analystName = analyst?.full_name ?? "analista";
    const rawReason = reason ?? camp.rejection_reason ?? "";
    const isApproved = decision === "approved";
    const subject = isApproved
      ? `✅ Campanha aprovada: ${title}`
      : `❌ Campanha rejeitada: ${title}`;
    const eTitle = escapeHtml(title);
    const eSup = escapeHtml(supName);
    const eAnalyst = escapeHtml(analystName);
    const eReason = escapeHtml(rawReason);
    const html = isApproved
      ? `<p>Olá, ${eAnalyst}.</p>
         <p>Sua campanha <b>${eTitle}</b> foi <b>aprovada</b> por ${eSup}.</p>
         <p>Ela já pode ser disparada.</p>
         <p><a href="${url}">Abrir campanha</a></p>`
      : `<p>Olá, ${eAnalyst}.</p>
         <p>Sua campanha <b>${eTitle}</b> foi <b>rejeitada</b> por ${eSup}.</p>
         ${rawReason ? `<p><b>Motivo:</b> ${eReason}</p>` : ""}
         <p><a href="${url}">Revisar campanha</a></p>`;

    const results: Record<string, unknown> = { email: null, inbox: null };

    // Inbox interno (persistente) — sempre criamos, independente do canal de e-mail.
    const { error: inboxErr } = await supabase.from("internal_notifications").insert({
      user_id: camp.created_by,
      kind: isApproved ? "success" : "warning",
      title: subject,
      body: isApproved
        ? `Sua campanha "${title}" foi aprovada por ${supName}. Já pode ser disparada.`
        : `Sua campanha "${title}" foi rejeitada por ${supName}.${
            reason || camp.rejection_reason ? ` Motivo: ${reason ?? camp.rejection_reason}` : ""
          }`,
      link: "/comunicacao/massa",
      payload: {
        campaign_id,
        decision,
        reason: reason ?? camp.rejection_reason ?? null,
        supervisor_name: supName,
      },
    });
    results.inbox = inboxErr ? { error: inboxErr.message } : { ok: true };

    if (analyst?.email) {
      // Usa o pipeline corporativo (Outlook/Gmail via connector gateway),
      // que registra entrega em notification_deliveries.
      try {
        const r = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email-corporate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: analyst.email,
              subject,
              html,
              user_id: camp.created_by,
              event_key: `campaign.decision.${decision}`,
              template_key: `campaign_${decision}`,
            }),
          },
        );
        const body = await r.json().catch(() => ({}));
        results.email = {
          status: r.status,
          delivery_id: (body as { delivery_id?: string }).delivery_id ?? null,
          error: (body as { error?: string }).error ?? null,
        };
      } catch (e) {
        results.email = { status: 0, error: String(e) };
      }
    } else {
      results.email = { skipped: "analyst sem email cadastrado" };
    }

    return new Response(JSON.stringify({ ok: true, decision, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
