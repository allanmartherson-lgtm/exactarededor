import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type, prefer, x-active-hospital",
};

const BodySchema = z.object({
  mark_id: z.string().uuid(),
  decision: z.enum(["approve", "reject", "revoke"]),
  note: z.string().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: functionCorsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    const { mark_id, decision, note } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const canDecide = roleSet.has("admin") || roleSet.has("diretor") || roleSet.has("gestao_medica");
    if (!canDecide) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gate de hospital: a marca pertence a um lote; o chamador precisa ter acesso a ele.
    const { data: markRow } = await admin
      .from("special_case_marks").select("id, payment_id").eq("id", mark_id).maybeSingle();
    if (!markRow) {
      return new Response(JSON.stringify({ error: "mark_not_found" }), {
        status: 404, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: markPayment } = await admin
      .from("payments").select("id, hospital_id").eq("id", markRow.payment_id).maybeSingle();
    if (!assertCallerHospital(_auth, (markPayment as { hospital_id?: string } | null)?.hospital_id ?? "")) {
      return new Response(JSON.stringify({ error: "hospital_scope_denied", message: "Sem acesso a este hospital." }), {
        status: 403, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();
    const patch: any = {};
    if (decision === "approve") {
      patch.status = "approved";
      patch.approved_by = user.id;
      patch.approved_at = nowIso;
      patch.approval_note = note ?? null;
    } else if (decision === "reject") {
      patch.status = "rejected";
      patch.rejected_by = user.id;
      patch.rejected_at = nowIso;
      patch.rejection_reason = note ?? null;
    } else {
      patch.status = "revoked";
      patch.revoked_by = user.id;
      patch.revoked_at = nowIso;
      patch.revocation_reason = note ?? null;
    }

    const { data: updated, error: updErr } = await admin
      .from("special_case_marks").update(patch).eq("id", mark_id).select("*").single();
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("audit_log").insert({
      user_id: user.id,
      action: `special_case_${decision}`,
      entity_type: "special_case_marks",
      entity_id: mark_id,
      metadata: { payment_id: updated.payment_id, attendance_number: updated.attendance_number, type: updated.special_case_type_code, note },
    });

    // Reanalisa o pagamento — qualquer mudança de status (approve/reject/revoke)
    // altera quais regras o motor considera para aquele atendimento.
    try {
      await admin.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: updated.payment_id },
      });
    } catch (dispatchErr) {
      console.error("[decide-special-case] falha ao disparar reanálise:", dispatchErr);
    }

    return new Response(JSON.stringify({ ok: true, mark: updated }), {
      headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("decide-special-case error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  }
});
