// Enfileira evento de re-aprovação de grupo. O envio consolidado (e-mail + WhatsApp)
// é feito pelo notification-queue-worker via handler director_reapproval.
//
// Body: { paymentId: string, companyGroupId: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEBOUNCE_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { paymentId, companyGroupId } = await req.json();
    if (!paymentId || typeof paymentId !== "string" || !companyGroupId || typeof companyGroupId !== "string") {
      return new Response(JSON.stringify({ error: "paymentId e companyGroupId obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: group, error: gErr } = await supabase
      .from("payment_company_groups")
      .select("id, payment_id, company_name, bruto_total, liquido_total, last_approved_bruto, last_approved_liquido, last_approved_company_id, reapproval_pending, reapproval_trigger_source, reapproval_reason")
      .eq("id", companyGroupId)
      .maybeSingle();

    if (gErr || !group) {
      return new Response(JSON.stringify({ error: "grupo não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!group.reapproval_pending) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_pending_reapproval" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = {
      company_group_id: group.id,
      company_name: group.company_name,
      bruto_before: Number(group.last_approved_bruto ?? 0),
      bruto_after: Number(group.bruto_total ?? 0),
      liquido_before: Number(group.last_approved_liquido ?? 0),
      liquido_after: Number(group.liquido_total ?? 0),
      trigger_source: group.reapproval_trigger_source,
      reason: group.reapproval_reason,
      at: new Date().toISOString(),
    };

    const { data: queueId, error: enqueueErr } = await supabase.rpc("enqueue_notification", {
      p_kind: "director_reapproval",
      p_payment_id: paymentId,
      p_event: event,
      p_sender_id: null,
      p_debounce_seconds: DEBOUNCE_SECONDS,
    });

    if (enqueueErr) {
      console.error("enqueue_notification error", enqueueErr);
      return new Response(JSON.stringify({ ok: false, error: String(enqueueErr) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, enqueued: true, queue_id: queueId, debounce_seconds: DEBOUNCE_SECONDS }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-director-reapproval error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
