import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "company" | "doctor";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Apenas administradores podem cadastrar usuários de portal" }, 403);

    const body = await req.json();
    const kind = String(body.kind ?? "") as Kind;
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const entityId = String(body.entity_id ?? "").trim();
    const hospitalIds: string[] = Array.isArray(body.hospital_ids) ? body.hospital_ids : [];
    const primaryHospitalId = body.primary_hospital_id ? String(body.primary_hospital_id) : null;
    const sendInvite = body.send_invite !== false;

    const rawOrigin = String(body.app_origin ?? "").trim();
    const isAllowedOrigin = (o: string) => {
      try {
        const u = new URL(o);
        if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) return false;
        return /(^|\.)lovable\.(app|dev)$/.test(u.hostname)
          || /(^|\.)lovableproject\.com$/.test(u.hostname)
          || u.hostname === "localhost"
          || u.hostname === "127.0.0.1";
      } catch { return false; }
    };
    const appOrigin = isAllowedOrigin(rawOrigin) ? rawOrigin.replace(/\/+$/, "") : "";
    const redirectTo = appOrigin ? `${appOrigin}/auth/reset-password` : undefined;

    if (!["company", "doctor"].includes(kind)) return json({ error: "kind inválido" }, 400);
    if (!email) return json({ error: "E-mail obrigatório" }, 400);
    if (!entityId) return json({ error: kind === "company" ? "Empresa obrigatória" : "Médico obrigatório" }, 400);

    const portalTable = kind === "company" ? "company_portal_users" : "doctor_portal_users";
    const linkTable = kind === "company" ? "company_portal_user_hospitals" : "doctor_portal_user_hospitals";
    const parentFk = kind === "company" ? "company_id" : "doctor_id";

    // 1) Auth user (invite ou createUser com senha temporária)
    let newUserId: string | null = null;
    let tempPassword: string | null = null;
    const userMeta = { full_name: fullName, portal_kind: kind };

    // Reaproveita usuário se já existe (mesmo email)
    const { data: existingByEmail } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingByEmail?.id) {
      newUserId = existingByEmail.id;
    } else if (sendInvite) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: userMeta,
        redirectTo,
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    } else {
      tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { ...userMeta, must_reset_password: true },
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    }

    if (!newUserId) throw new Error("Falha ao criar usuário");

    // 2) Profile
    await admin.from("profiles").upsert(
      { id: newUserId, email, full_name: fullName || null },
      { onConflict: "id" },
    );

    // 3) IMPORTANTE: NÃO insere em user_roles — portal não tem acesso ao Exacta

    // 4) Vínculo na tabela de portal (reativa se já existir)
    const { data: existingLink } = await admin
      .from(portalTable)
      .select("id")
      .eq("user_id", newUserId)
      .eq(parentFk, entityId)
      .maybeSingle();

    let portalRowId: string;
    if (existingLink?.id) {
      portalRowId = existingLink.id;
      await admin.from(portalTable).update({ active: true }).eq("id", existingLink.id);
    } else {
      const { data: inserted, error: insErr } = await admin
        .from(portalTable)
        .insert({
          user_id: newUserId,
          [parentFk]: entityId,
          invited_by: userData.user.id,
          invited_at: new Date().toISOString(),
          active: true,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      portalRowId = inserted.id;
    }

    // 5) Hospitais
    if (hospitalIds.length > 0) {
      await admin.from(linkTable).delete().eq("portal_user_id", portalRowId);
      const payload = hospitalIds.map((hid) => ({
        portal_user_id: portalRowId,
        hospital_id: hid,
        is_primary: hid === primaryHospitalId,
      }));
      const { error: linkErr } = await admin.from(linkTable).insert(payload);
      if (linkErr) throw linkErr;
    }

    await admin.from("audit_log").insert({
      actor_id: userData.user.id,
      entity_type: `portal_user_${kind}`,
      entity_id: portalRowId,
      action: "created",
      diff: { email, full_name: fullName, entity_id: entityId, hospital_ids: hospitalIds },
    });

    return json({ success: true, user_id: newUserId, portal_row_id: portalRowId, temp_password: tempPassword });
  } catch (e) {
    console.error("admin-create-portal-user error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
