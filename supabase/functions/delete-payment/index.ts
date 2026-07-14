// Edge function: delete-payment
// Exclui um lote de pagamento usando service_role para evitar o statement_timeout
// do PostgREST (lotes grandes — centenas de itens + cascades — não cabem
// na janela padrão de ~8s do role authenticated).
//
// Autoriza a chamada validando o JWT do usuário e checando se ele tem
// permissão para excluir (admin/diretor OU criador em status editável).
// A exclusão real roda como service_role, ignorando RLS e timeouts curtos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Admin/diretor podem apagar em qualquer status editável (inclusive devoluções).
const DELETABLE_STATUSES = new Set([
  "rascunho",
  "em_analise_ia",
  "aguardando_validacao",
  "devolvido_analista",
  "revisao_analista",
  "cancelado",
]);

// Analista (criador) só pode apagar enquanto o lote está na PRIMEIRA análise
// e ainda não avançou. Se voltou para revisao_analista/devolvido_analista
// (ou seja, já andou e retornou), não pode mais apagar.
const ANALISTA_INITIAL_STATUSES = new Set([
  "rascunho",
  "em_analise_ia",
  "aguardando_validacao",
]);

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

  // Cliente "como usuário" só para identificar quem chama.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: { payment_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const paymentId = body.payment_id;
  if (!paymentId) return json({ error: "missing_payment_id" }, 400);

  // Cliente admin (service_role) — usado para checagem de papéis e delete.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Carrega o payment para checar created_by/status.
  const { data: payment, error: payErr } = await admin
    .from("payments")
    .select("id, status, created_by")
    .eq("id", paymentId)
    .maybeSingle();
  if (payErr) return json({ error: "load_failed", detail: payErr.message }, 500);
  if (!payment) return json({ error: "not_found" }, 404);

  // 2. Checa papéis do usuário.
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = new Set((roleRows ?? []).map((r) => r.role));
  const isAdmin = roles.has("admin");
  const isDiretor = roles.has("diretor");
  const isAnalista = roles.has("analista");
  const isCreator = payment.created_by === userId;
  const statusOk = DELETABLE_STATUSES.has(payment.status as string);
  const analistaCanDelete =
    isAnalista && isCreator && ANALISTA_INITIAL_STATUSES.has(payment.status as string);

  if (!(isAdmin || isDiretor || (isCreator && statusOk) || analistaCanDelete)) {
    return json({ error: "forbidden" }, 403);
  }

  // 3. Delete via RPC SECURITY DEFINER — zera statement_timeout localmente
  //    para suportar lotes grandes (centenas de itens + cascades).
  const { error: rpcErr } = await admin.rpc("admin_delete_payment", {
    _payment_id: paymentId,
  });
  if (rpcErr) {
    console.error("[delete-payment] rpc falhou:", rpcErr.message);
    return json({ error: "delete_failed", detail: rpcErr.message }, 500);
  }

  return json({ ok: true });
});
