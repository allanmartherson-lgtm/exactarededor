// Sends a WhatsApp message via Twilio (through the connector gateway).
// Uses an approved template from public.whatsapp_templates.
// Logs the attempt in notification_deliveries.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";

const BodySchema = z.object({
  to_phone_e164: z.string().regex(/^\+\d{8,15}$/),
  template_key: z.string().min(1),
  variables: z.record(z.string()).default({}),
  user_id: z.string().uuid().optional(),
  payment_id: z.string().uuid().optional(),
  event_key: z.string().min(1),
  queue_id: z.string().uuid().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  const fromNumber = Deno.env.get("TWILIO_WHATSAPP_FROM"); // e.g. "whatsapp:+14155238886"

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: deliv } = await admin.from("notification_deliveries").insert({
    queue_id: body.queue_id ?? null,
    user_id: body.user_id ?? null,
    payment_id: body.payment_id ?? null,
    event_key: body.event_key,
    channel: "whatsapp",
    target_address: body.to_phone_e164,
    template_key: body.template_key,
    status: "queued",
    attempts: 1,
  }).select("id").single();

  if (!lovableKey || !twilioKey) return finalize(admin, deliv?.id, "failed", null, "Twilio connector not linked");
  if (!fromNumber) return finalize(admin, deliv?.id, "failed", null, "TWILIO_WHATSAPP_FROM not configured");

  // Resolve template SID
  const { data: tpl } = await admin
    .from("whatsapp_templates")
    .select("provider_template_sid, is_active")
    .eq("template_key", body.template_key)
    .maybeSingle();

  if (!tpl || !tpl.is_active) return finalize(admin, deliv?.id, "failed", null, `Template "${body.template_key}" not active`);

  try {
    const form = new URLSearchParams({
      From: fromNumber,
      To: `whatsapp:${body.to_phone_e164}`,
      ContentSid: tpl.provider_template_sid,
      ContentVariables: JSON.stringify(body.variables),
    });

    const r = await fetch(`${GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return finalize(admin, deliv?.id, "failed", null, `Twilio ${r.status}: ${JSON.stringify(data)}`);

    return finalize(admin, deliv?.id, "sent", data.sid ?? null, null);
  } catch (e) {
    return finalize(admin, deliv?.id, "failed", null, String(e));
  }
});

async function finalize(admin: any, id: string | undefined, status: string, providerId: string | null, error: string | null) {
  if (id) {
    await admin.from("notification_deliveries").update({
      status,
      provider_message_id: providerId,
      error_message: error,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      failed_at: status === "failed" ? new Date().toISOString() : null,
    }).eq("id", id);
  }
  return json({ success: status === "sent", delivery_id: id, error }, status === "sent" ? 200 : 502);
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
