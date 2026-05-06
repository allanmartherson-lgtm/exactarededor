import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id, _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas administradores podem criar usuários" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const phone = String(body.phone ?? "").trim() || null;
    const roleTitle = String(body.role_title ?? "").trim() || null;
    const department = String(body.department ?? "").trim() || null;
    const birthDateRaw = String(body.birth_date ?? "").trim();
    const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw) ? birthDateRaw : null;
    const roles: string[] = Array.isArray(body.roles) ? body.roles : [];
    const sendInvite = body.send_invite !== false; // default true
    const accessRequestId = body.access_request_id ? String(body.access_request_id) : null;
    const rawOrigin = String(body.app_origin ?? "").trim();
    // Sanitiza origem para evitar open-redirect: aceita apenas ambientes Lovable e localhost.
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

    if (!email) {
      return new Response(JSON.stringify({ error: "E-mail obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let newUserId: string | null = null;
    let tempPassword: string | null = null;

    if (sendInvite) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    } else {
      // Create with random password; user resets on first login
      tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, must_reset_password: true },
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    }

    if (!newUserId) throw new Error("Falha ao criar usuário");

    // Ensure profile exists/updated
    await admin.from("profiles").upsert({
      id: newUserId, email, full_name: fullName || null,
    }, { onConflict: "id" });

    // Assign roles
    const validRoles = ["admin", "diretor", "validador", "analista"];
    const filtered = roles.filter((r) => validRoles.includes(r));
    if (filtered.length) {
      await admin.from("user_roles").insert(
        filtered.map((role) => ({ user_id: newUserId, role }))
      );
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUserId, temp_password: tempPassword }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("admin-create-user error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});