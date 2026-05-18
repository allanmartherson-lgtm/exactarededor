// Notifica validadores quando o analista envia uma empresa para validação.
// Agora ENFILEIRA o evento via `enqueue_notification`. Um worker em background
// consolida múltiplos eventos do mesmo pagamento em um único e-mail (debounce 60s).
// Audit log continua sendo registrado por evento (registro contábil).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEBOUNCE_SECONDS = 60;

interface Body {
  payment_id: string;
  group_id?: string | null;
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

    let companyName: string | null = null;
    let companyId: string | null = null;
    let groupTotalAmount = 0;
    let groupItemsCount = 0;
    if (body.group_id) {
      const { data: g } = await supabase
        .from("payment_company_groups")
        .select("id, company_name, company_id, total_amount, items_count")
        .eq("id", body.group_id)
        .maybeSingle();
      companyName = g?.company_name ?? null;
      companyId = g?.company_id ?? null;
      groupTotalAmount = Number(g?.total_amount ?? 0);
      groupItemsCount = Number(g?.items_count ?? 0);
    }

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
    const event = {
      group_id: body.group_id ?? null,
      company_name: companyName,
      company_id: companyId,
      sender_id: body.sender_id ?? null,
      sender_name: senderName,
      total_amount: groupTotalAmount,
      items_count: groupItemsCount,
      at: sentAt,
    };

    const { data: queueId, error: enqueueErr } = await supabase.rpc("enqueue_notification", {
      p_kind: "validator_assignment",
      p_payment_id: body.payment_id,
      p_event: event,
      p_sender_id: body.sender_id ?? null,
      p_debounce_seconds: DEBOUNCE_SECONDS,
    });

    if (enqueueErr) {
      console.error("enqueue_notification error", enqueueErr);
      return new Response(JSON.stringify({ ok: false, error: String(enqueueErr) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log imediato (registro contábil por evento)
    await supabase.from("audit_log").insert({
      actor_id: body.sender_id ?? null,
      entity_type: "payment_company_group",
      entity_id: body.group_id ?? body.payment_id,
      action: "validation_assigned",
      diff: {
        payment: {
          reference: payment.reference,
          items_count: payment.items_count,
          total_amount: payment.total_amount,
        },
        group: body.group_id ? { id: body.group_id, company_name: companyName } : null,
        sender: body.sender_id ? { id: body.sender_id, name: senderName } : null,
        enqueued: { queue_id: queueId, debounce_seconds: DEBOUNCE_SECONDS },
        sent_at: sentAt,
      },
      company_id: companyId,
      company_name: companyName,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        enqueued: true,
        queue_id: queueId,
        debounce_seconds: DEBOUNCE_SECONDS,
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
