// Edge function: clear-company-items
// Apaga todos os payment_items de uma empresa dentro de um lote usando
// service_role + RPC com statement_timeout=0, evitando o limite curto do
// PostgREST (que estoura "canceling statement due to statement timeout"
// quando há muitos itens + cascades).
//
// Reutilizado pelo fluxo "Reimportar base" da empresa.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "missing_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: { payment_id?: string; company_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const paymentId = body.payment_id;
  const companyName = body.company_name;
  if (!paymentId || !companyName) {
    return json({ error: "missing_params" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Permissão: criador do lote OU admin/diretor OU analista do hospital.
  const { data: payment, error: payErr } = await admin
    .from("payments")
    .select("id, status, created_by, hospital_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (payErr) return json({ error: "load_failed", detail: payErr.message }, 500);
  if (!payment) return json({ error: "not_found" }, 404);

  if (!_auth.is_internal && !assertCallerHospital(_auth, (payment as any)?.hospital_id ?? null)) {
    return json({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }, 403);
  }

  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = new Set((roleRows ?? []).map((r) => r.role));
  const isPrivileged = roles.has("admin") || roles.has("diretor") || roles.has("analista");
  const isCreator = payment.created_by === userId;
  if (!(isPrivileged || isCreator)) return json({ error: "forbidden" }, 403);

  const { data: deleted, error: rpcErr } = await admin.rpc("admin_clear_company_items", {
    _payment_id: paymentId,
    _company_name: companyName,
    _actor_id: userId,
  });
  if (rpcErr) {
    console.error("[clear-company-items] rpc falhou:", rpcErr.message);
    return json({ error: "delete_failed", detail: rpcErr.message }, 500);
  }

  return json({ ok: true, deleted: deleted ?? 0 });
});
