// Edge function: apply-email-approval
// Aplica uma aprovação por e-mail já VALIDADA chamando o mesmo RPC approve_payment
// que o botão "Aprovar lote" no sistema. Registra a origem como "email" no audit_log.
//
// Input:  { approval_id: string }
// Output: { approved_groups: number }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "missing_env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Autenticação do chamador (precisamos saber quem clicou em "Aplicar")
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing_auth" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "invalid_auth", details: userErr?.message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Role gate: apenas papéis internos com poder de aprovação podem aplicar aprovações por e-mail.
  const admin0 = createClient(supabaseUrl, serviceKey);
  const { data: rolesRows } = await admin0
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const allowedRoles = new Set(["admin", "diretor", "analista", "validador"]);
  const hasRole = (rolesRows ?? []).some((r: { role: string }) => allowedRoles.has(r.role));
  if (!hasRole) {
    return new Response(JSON.stringify({ error: "forbidden", message: "Sem permissão para aplicar aprovação por e-mail." }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let approval_id: string | undefined;
  try { ({ approval_id } = await req.json()); } catch { /* */ }
  if (!approval_id) {
    return new Response(JSON.stringify({ error: "approval_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // 1) Carrega aprovação e exige status=validated
  const { data: approval, error: loadErr } = await admin
    .from("payment_email_approvals")
    .select("id, payment_id, hospital_id, status, extracted, matched_director_id")
    .eq("id", approval_id)
    .maybeSingle();
  if (loadErr || !approval) {
    return new Response(JSON.stringify({ error: "approval_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (approval.status !== "validated") {
    return new Response(JSON.stringify({
      error: "approval_not_validated",
      message: "Só aprovações com leitura validada podem ser aplicadas.",
      current_status: approval.status,
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Hospital gate: caller must have access to the approval's hospital (admin/diretor bypass).
  const isAdminOrDir = (rolesRows ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "diretor");
  if (!isAdminOrDir && approval.hospital_id) {
    const { data: uh } = await admin0
      .from("user_hospitals")
      .select("hospital_id")
      .eq("user_id", user.id)
      .eq("hospital_id", approval.hospital_id)
      .maybeSingle();
    if (!uh) {
      return new Response(JSON.stringify({ error: "forbidden_hospital", message: "Sem acesso a este hospital." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 2) Pega grupos aguardando aprovação
  const { data: groups, error: gErr } = await admin
    .from("payment_company_groups")
    .select("id, status")
    .eq("payment_id", approval.payment_id)
    .eq("status", "aguardando_aprovacao");
  if (gErr) {
    return new Response(JSON.stringify({ error: "groups_query_failed", details: gErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!groups || groups.length === 0) {
    return new Response(JSON.stringify({
      error: "no_groups_awaiting_approval",
      message: "Não há empresas aguardando aprovação neste lote.",
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Nome do aprovador (preferimos o cadastrado no hospital_directors)
  let approverName = "Diretor (aprovação por e-mail)";
  if (approval.matched_director_id) {
    const { data: dir } = await admin
      .from("hospital_directors")
      .select("full_name")
      .eq("id", approval.matched_director_id)
      .maybeSingle();
    if (dir?.full_name) approverName = dir.full_name;
  } else {
    const ex = approval.extracted as { approver_name?: string } | null;
    if (ex?.approver_name) approverName = ex.approver_name;
  }

  // 3) Chama approve_payment usando o uid do clicador como ator
  const note = `Aprovação por e-mail anexada (id: ${approval.id}). Aprovador identificado: ${approverName}.`;
  const { error: rpcErr } = await admin.rpc("approve_payment", {
    p_payment_id: approval.payment_id,
    p_group_ids: groups.map((g) => g.id),
    p_author_id: user.id,
    p_author_name: approverName,
    p_note: note,
  });
  if (rpcErr) {
    return new Response(JSON.stringify({ error: "approve_payment_failed", details: rpcErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4) Marca como aplicada
  await admin.from("payment_email_approvals").update({
    status: "applied",
    applied_at: new Date().toISOString(),
    applied_by: user.id,
  }).eq("id", approval.id);

  // 5) Audit
  await admin.from("audit_log").insert({
    actor_id: user.id,
    entity_type: "payment",
    entity_id: approval.payment_id,
    action: "approved_by_email",
    diff: {
      approval_id: approval.id,
      approver_name: approverName,
      matched_director_id: approval.matched_director_id,
      groups_approved: groups.length,
      extracted: approval.extracted,
    },
  } as never);

  return new Response(JSON.stringify({ approved_groups: groups.length, approver_name: approverName }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
