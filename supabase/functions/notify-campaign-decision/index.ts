// Envia notificação ao analista criador quando o supervisor aprova ou rejeita uma campanha.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  "https://id-preview--1d07beac-8028-420b-ab8b-15b99a77170a.lovable.app";
const EMAIL_FROM = "Exacta <onboarding@resend.dev>";

interface Body {
  campaign_id: string;
  decision: "approved" | "rejected";
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { campaign_id, decision, reason } = (await req.json()) as Body;
    if (!campaign_id || !decision) {
      return new Response(JSON.stringify({ error: "campaign_id e decision são obrigatórios" }), {
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
    const isApproved = decision === "approved";
    const subject = isApproved
      ? `✅ Campanha aprovada: ${title}`
      : `❌ Campanha rejeitada: ${title}`;
    const html = isApproved
      ? `<p>Olá, ${analyst?.full_name ?? "analista"}.</p>
         <p>Sua campanha <b>${title}</b> foi <b>aprovada</b> por ${supName}.</p>
         <p>Ela já pode ser disparada.</p>
         <p><a href="${url}">Abrir campanha</a></p>`
      : `<p>Olá, ${analyst?.full_name ?? "analista"}.</p>
         <p>Sua campanha <b>${title}</b> foi <b>rejeitada</b> por ${supName}.</p>
         ${reason || camp.rejection_reason ? `<p><b>Motivo:</b> ${reason ?? camp.rejection_reason}</p>` : ""}
         <p><a href="${url}">Revisar campanha</a></p>`;

    const results: Record<string, unknown> = { email: null };

    if (analyst?.email) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (lovableKey && resendKey) {
        const r = await fetch(`${RESEND_GATEWAY}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": resendKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: analyst.email,
            subject,
            html,
          }),
        });
        results.email = { status: r.status };
      } else {
        results.email = { skipped: "missing keys" };
      }
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
