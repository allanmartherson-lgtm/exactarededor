// Issues a single-use magic-link JWT for a payment action (approve/reject/return/view).
// Called server-to-server from the notification worker; requires authenticated caller with appropriate role.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { signMagicLink, sha256Hex } from "../_shared/magicLink.ts";

const BodySchema = z.object({
  action: z.enum(["approve", "reject", "return_to_analyst", "return_to_validator", "view"]),
  payment_id: z.string().uuid(),
  company_group_id: z.string().uuid().optional(),
  issued_to_user_id: z.string().uuid(),
  issued_to_email: z.string().email(),
  ttl_hours: z.number().int().min(1).max(168).default(72),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pre-insert record to obtain the canonical id, then sign with that id.
  const expiresAt = new Date(Date.now() + body.ttl_hours * 3600 * 1000).toISOString();
  const { data: row, error: insertErr } = await admin
    .from("magic_link_tokens")
    .insert({
      token_hash: "pending",
      action: body.action,
      payment_id: body.payment_id,
      company_group_id: body.company_group_id ?? null,
      issued_to_user_id: body.issued_to_user_id,
      issued_to_email: body.issued_to_email,
      payload: {},
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertErr || !row) return json({ error: insertErr?.message ?? "insert_failed" }, 500);

  const jwt = await signMagicLink({
    jti: row.id,
    sub: body.issued_to_user_id,
    act: body.action,
    pid: body.payment_id,
    cgid: body.company_group_id,
  }, body.ttl_hours * 3600);

  const hash = await sha256Hex(jwt);
  await admin.from("magic_link_tokens").update({ token_hash: hash }).eq("id", row.id);

  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "";
  const url = `${appUrl}/aprovar/${jwt}`;

  return json({ token: jwt, url, expires_at: expiresAt, id: row.id }, 200);
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
