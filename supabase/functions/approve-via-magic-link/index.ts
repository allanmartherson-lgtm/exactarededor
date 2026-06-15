// Public endpoint (verify_jwt = false). Validates the magic-link JWT, checks the DB record
// is not used/expired/revoked, performs the requested action and marks the token as used.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { verifyMagicLink, sha256Hex } from "../_shared/magicLink.ts";

const BodySchema = z.object({
  token: z.string().min(20),
  confirm: z.boolean().default(false), // first call = preview; second call with confirm=true executes
  comment: z.string().max(2000).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

  const { token, confirm, comment } = parsed.data;

  let claims;
  try {
    claims = await verifyMagicLink(token);
  } catch (e) {
    return json({ error: "invalid_or_expired_token", detail: String(e) }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const hash = await sha256Hex(token);
  const { data: row, error: fetchErr } = await admin
    .from("magic_link_tokens")
    .select("*")
    .eq("id", claims.jti)
    .eq("token_hash", hash)
    .maybeSingle();

  if (fetchErr || !row) return json({ error: "token_not_found" }, 404);
  if (row.used_at) return json({ error: "token_already_used", used_at: row.used_at }, 410);
  if (row.revoked_at) return json({ error: "token_revoked", reason: row.revoked_reason }, 410);
  if (new Date(row.expires_at) < new Date()) return json({ error: "token_expired" }, 410);

  // Load payment summary
  const { data: payment } = await admin
    .from("payments")
    .select("id, status, competence_month, total_amount, batch_number")
    .eq("id", row.payment_id)
    .maybeSingle();

  if (!payment) return json({ error: "payment_not_found" }, 404);

  // PREVIEW mode: return data without executing.
  // Para ações de re-aprovação, carrega o grupo + diff antes/depois para a UI.
  if (!confirm) {
    let group_diff: unknown = null;
    if (
      (row.action === "approve_reapproval" || row.action === "reject_reapproval") &&
      row.company_group_id
    ) {
      const { data: g } = await admin
        .from("payment_company_groups")
        .select(
          "id, company_name, company_id, approval_version, reapproval_pending, reapproval_reason, reapproval_trigger_source, bruto_total, liquido_total, last_approved_bruto, last_approved_liquido, last_approved_company_id",
        )
        .eq("id", row.company_group_id)
        .maybeSingle();

      let last_approved_company_name: string | null = null;
      if (g?.last_approved_company_id && g.last_approved_company_id !== g.company_id) {
        const { data: oldComp } = await admin
          .from("companies")
          .select("name")
          .eq("id", g.last_approved_company_id)
          .maybeSingle();
        last_approved_company_name = oldComp?.name ?? null;
      }
      group_diff = g ? { ...g, last_approved_company_name } : null;
    }

    return json({
      preview: true,
      action: row.action,
      payment: payment,
      issued_to_email: row.issued_to_email,
      expires_at: row.expires_at,
      group_diff,
    }, 200);
  }

  // EXECUTE mode: perform the action
  const transitions: Record<string, string> = {
    approve: "aprovado",
    reject: "rejeitado",
    return_to_analyst: "devolvido_analista",
    return_to_validator: "aguardando_validacao",
    view: payment.status, // no-op
  };

  // ============================================================
  // Re-aprovação por grupo: ações específicas para grupo de empresa.
  // approve_reapproval insere nova versão em company_group_approvals
  // (triggers do banco fazem snapshot + liberam reapproval_pending).
  // reject_reapproval devolve apenas o grupo para o analista.
  // ============================================================
  if (row.action === "approve_reapproval" || row.action === "reject_reapproval") {
    if (!row.company_group_id) {
      return json({ error: "missing_company_group_id" }, 400);
    }

    const { data: group, error: gErr } = await admin
      .from("payment_company_groups")
      .select("id, hospital_id, bruto_total, liquido_total, company_id, approval_version, reapproval_pending, reapproval_reason, reapproval_trigger_source")
      .eq("id", row.company_group_id)
      .maybeSingle();

    if (gErr || !group) return json({ error: "group_not_found" }, 404);
    if (!group.reapproval_pending) {
      return json({ error: "no_pending_reapproval" }, 409);
    }

    if (row.action === "approve_reapproval") {
      const nextVersion = (group.approval_version ?? 0) + 1;
      const { error: insErr } = await admin
        .from("company_group_approvals")
        .insert({
          payment_company_group_id: group.id,
          hospital_id: group.hospital_id,
          version: nextVersion,
          approved_by: row.issued_to_user_id,
          bruto_total: group.bruto_total,
          liquido_total: group.liquido_total,
          company_id: group.company_id,
          reason: comment ?? group.reapproval_reason,
          magic_link_token_id: row.id,
        });
      if (insErr) return json({ error: "approval_insert_failed", detail: insErr.message }, 409);
    } else {
      // reject_reapproval → mantém pendente, devolve grupo ao analista via observação
      const { error: obsErr } = await admin.from("payment_observations").insert({
        payment_id: row.payment_id,
        author_user_id: row.issued_to_user_id,
        author_type: "diretor",
        observation_type: "magic_link_action",
        message: `[Grupo ${group.id}] Re-aprovação rejeitada pelo diretor via magic link.${comment ? "\n\nComentário: " + comment : ""}`,
        metadata: { ip, user_agent: ua, action: row.action, company_group_id: group.id },
      });
      if (obsErr) return json({ error: "rejection_log_failed", detail: obsErr.message }, 409);
    }

    await admin
      .from("magic_link_tokens")
      .update({ used_at: new Date().toISOString(), used_by_ip: ip, used_by_user_agent: ua })
      .eq("id", row.id);

    return json({
      success: true,
      action: row.action,
      payment_id: row.payment_id,
      company_group_id: group.id,
      new_version: row.action === "approve_reapproval" ? (group.approval_version ?? 0) + 1 : group.approval_version,
    }, 200);
  }

  const newStatus = transitions[row.action];

  if (row.action !== "view") {
    // Update payment status; rely on existing trigger for status_history
    const { error: updErr } = await admin
      .from("payments")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", row.payment_id);

    if (updErr) return json({ error: "transition_failed", detail: updErr.message }, 409);

    // Log observation
    await admin.from("payment_observations").insert({
      payment_id: row.payment_id,
      author_user_id: row.issued_to_user_id,
      observation_type: "magic_link_action",
      content: `Ação "${row.action}" via magic link.${comment ? "\n\nComentário: " + comment : ""}`,
      metadata: { ip, user_agent: ua, action: row.action },
    });
  }

  // Mark token as used
  await admin
    .from("magic_link_tokens")
    .update({
      used_at: new Date().toISOString(),
      used_by_ip: ip,
      used_by_user_agent: ua,
    })
    .eq("id", row.id);

  return json({
    success: true,
    action: row.action,
    new_status: newStatus,
    payment_id: row.payment_id,
  }, 200);
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
