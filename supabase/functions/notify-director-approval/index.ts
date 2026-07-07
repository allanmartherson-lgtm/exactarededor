// Enfileira evento de aprovação de diretor. O envio consolidado (e-mail + WhatsApp)
// é feito pelo notification-queue-worker via handler director_approval.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEBOUNCE_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Só chamadores internos (service-role) OU usuários autenticados com papel interno.
  // Evita que a Internet enumere/dispare notificações de aprovação via anon key.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const bearer = authHeader.replace("Bearer ", "").trim();
  const serviceKeyEnv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let isInternal = bearer === serviceKeyEnv;
  if (!isInternal) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1] ?? ""));
      if (payload?.role === "service_role") isInternal = true;
    } catch { /* not JWT */ }
  }
  if (!isInternal) {
    // Valida usuário + papel interno
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser(bearer);
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const allowed = new Set(["admin", "diretor", "validador", "analista", "gestao_medica"]);
    const has = (roles ?? []).some((r: { role: string }) => allowed.has(r.role));
    if (!has) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { paymentId } = await req.json();

    if (!paymentId || typeof paymentId !== "string") {
      return new Response(JSON.stringify({ error: "paymentId obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: payment, error: pErr } = await supabase
      .from("payments")
      .select("id, reference, status, total_amount")
      .eq("id", paymentId)
      .maybeSingle();

    if (pErr || !payment) {
      return new Response(JSON.stringify({ error: "Pagamento não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (payment.status !== "aguardando_aprovacao") {
      return new Response(JSON.stringify({ skipped: true, reason: "wrong_status", status: payment.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotência: se já houve notificação consolidada processada para esse pagamento, não enfileira de novo.
    const { data: alreadySent } = await supabase
      .from("notification_queue")
      .select("id")
      .eq("kind", "director_approval")
      .eq("payment_id", paymentId)
      .not("sent_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (alreadySent) {
      return new Response(JSON.stringify({ skipped: true, reason: "already_notified" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = {
      reference: payment.reference,
      total_amount: Number(payment.total_amount ?? 0),
      at: new Date().toISOString(),
    };

    const { data: queueId, error: enqueueErr } = await supabase.rpc("enqueue_notification", {
      p_kind: "director_approval",
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
    console.error("notify-director-approval error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
