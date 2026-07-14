import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type, prefer, x-active-hospital",
};

const BodySchema = z.object({
  payment_id: z.string().uuid(),
  attendance_number: z.string().min(1),
  item_id: z.string().uuid().nullable().optional(),
  special_case_type_code: z.string().min(1),
  justification: z.string().optional(),
  doctor_id: z.string().uuid().nullable().optional(),
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
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) {
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
    const body = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Verifica role
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const isInternal = roleSet.has("admin") || roleSet.has("diretor")
      || roleSet.has("analista") || roleSet.has("gestao_medica");
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega tipo + valida que existe e está ativo
    const { data: typeRow } = await admin
      .from("special_case_types")
      .select("code, requires_justification, active")
      .eq("code", body.special_case_type_code)
      .eq("active", true)
      .maybeSingle();
    if (!typeRow) {
      return new Response(JSON.stringify({ error: "tipo_invalido" }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeRow.requires_justification && (!body.justification || body.justification.trim().length < 5)) {
      return new Response(JSON.stringify({ error: "justificativa_obrigatoria" }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega payment para hospital_id
    const { data: payment } = await admin
      .from("payments").select("hospital_id").eq("id", body.payment_id).maybeSingle();
    if (!payment?.hospital_id) {
      return new Response(
        JSON.stringify({ error: "Pagamento sem hospital vinculado — não é possível marcar caso especial." }),
        { status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Conceito atualizado (jun/2026): analista tem autonomia total.
    // Marca já entra como `approved` — motor aplica regra de caso especial
    // imediatamente. Gestão médica/diretor recebe notificação informativa
    // (não-bloqueante) e pode REVOGAR depois via decide-special-case.
    const isGestao = roleSet.has("gestao_medica") || roleSet.has("admin") || roleSet.has("diretor");
    const origin = isGestao ? "gestao_medica" : "analista";
    const initialStatus = "approved";

    const payload: any = {
      payment_id: body.payment_id,
      attendance_number: body.attendance_number,
      item_id: body.item_id ?? null,
      doctor_id: body.doctor_id ?? null,
      special_case_type_code: body.special_case_type_code,
      status: initialStatus,
      origin,
      justification: body.justification ?? null,
      marked_by: user.id,
      hospital_id: payment.hospital_id,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    };

    let existingQuery = admin
      .from("special_case_marks")
      .select("*")
      .eq("payment_id", body.payment_id)
      .eq("attendance_number", body.attendance_number)
      .eq("special_case_type_code", body.special_case_type_code)
      .in("status", ["pending", "approved"]);
    existingQuery = body.item_id ? existingQuery.eq("item_id", body.item_id) : existingQuery.is("item_id", null);

    const { data: existingMark, error: existingErr } = await existingQuery.maybeSingle();
    if (existingErr) {
      return new Response(JSON.stringify({ error: existingErr.message }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingMark) {
      return new Response(JSON.stringify({ ok: true, mark: existingMark, already_exists: true }), {
        headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mark, error: insErr } = await admin
      .from("special_case_marks").insert(payload).select("*").single();

    if (insErr) {
      if (insErr.code === "23505" || insErr.message.includes("special_case_marks_active_unique")) {
        let duplicateQuery = admin
          .from("special_case_marks")
          .select("*")
          .eq("payment_id", body.payment_id)
          .eq("attendance_number", body.attendance_number)
          .eq("special_case_type_code", body.special_case_type_code)
          .in("status", ["pending", "approved"]);
        duplicateQuery = body.item_id ? duplicateQuery.eq("item_id", body.item_id) : duplicateQuery.is("item_id", null);
        const { data: duplicateMark } = await duplicateQuery.maybeSingle();
        if (duplicateMark) {
          return new Response(JSON.stringify({ ok: true, mark: duplicateMark, already_exists: true }), {
            headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 400, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auditoria
    await admin.from("audit_log").insert({
      user_id: user.id,
      action: "special_case_mark",
      entity_type: "special_case_marks",
      entity_id: mark.id,
      metadata: { payment_id: body.payment_id, attendance_number: body.attendance_number, type: body.special_case_type_code, status: initialStatus, origin },
    });

    // Inbox interno — notificação INFORMATIVA para gestão médica/diretor.
    // Não é mais um gate de aprovação; é só visibilidade. Eles podem revogar
    // se discordarem (decide-special-case com decision='revoke').
    {
      const { data: gestao } = await admin
        .from("user_roles")
        .select("user_id")
        .in("role", ["gestao_medica", "diretor"]);
      const inbox = (gestao ?? []).map((g: any) => ({
        user_id: g.user_id,
        kind: "info",
        title: "Caso especial marcado",
        body: `Atendimento ${body.attendance_number} marcado como "${body.special_case_type_code}" por ${origin}. Regra especial aplicada — revogue se necessário.`,
        link: "/casos-especiais",
        payload: {
          mark_id: mark.id,
          payment_id: body.payment_id,
          attendance_number: body.attendance_number,
          special_case_type_code: body.special_case_type_code,
          origin,
        },
      }));
      if (inbox.length > 0) {
        await admin.from("internal_notifications").insert(inbox);
      }
    }

    // Dispara reanálise do pagamento — fire-and-forget — para que o motor
    // recalcule os itens daquele atendimento já considerando a regra especial.
    try {
      await admin.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: body.payment_id },
      });
    } catch (dispatchErr) {
      console.error("[mark-special-case] falha ao disparar reanálise:", dispatchErr);
    }

    return new Response(JSON.stringify({ ok: true, mark }), {
      headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mark-special-case error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500, headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
    });
  }
});
