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
    const phoneRaw = String(body.phone ?? "").trim();
    const roleTitle = String(body.role_title ?? "").trim() || null;
    const department = String(body.department ?? "").trim() || null;
    const birthDateRaw = String(body.birth_date ?? "").trim();
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

    const bad = (msg: string) => new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    if (!email) return bad("E-mail obrigatório");

    // ---- Validação de telefone (BR: DDD válido + 9 + 8 dígitos) ----
    let phone: string | null = null;
    if (phoneRaw) {
      const d = phoneRaw.replace(/\D/g, "");
      const VALID_DDDS = new Set([
        11,12,13,14,15,16,17,18,19,21,22,24,27,28,
        31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,
        51,53,54,55,61,62,63,64,65,66,67,68,69,
        71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,
        91,92,93,94,95,96,97,98,99,
      ]);
      if (d.length !== 11) return bad("Telefone inválido: use DDD + 9 + 8 dígitos (11 números)");
      if (!VALID_DDDS.has(Number(d.slice(0, 2)))) return bad(`Telefone inválido: DDD ${d.slice(0,2)} não é válido`);
      if (d[2] !== "9") return bad("Telefone inválido: celular deve começar com 9 após o DDD");
      if (/^(\d)\1{10}$/.test(d)) return bad("Telefone inválido: dígitos repetidos");
      phone = d;
    }

    // ---- Validação de data de nascimento ----
    let birthDate: string | null = null;
    if (birthDateRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw)) return bad("Data de nascimento inválida (use AAAA-MM-DD)");
      const [y, m, dd] = birthDateRaw.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, dd));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== dd) {
        return bad("Data de nascimento inválida");
      }
      const today = new Date();
      const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      if (y < 1900) return bad("Data de nascimento anterior a 1900");
      if (dt.getTime() > todayUTC) return bad("Data de nascimento não pode estar no futuro");
      const ageYears = (todayUTC - dt.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears < 14) return bad("Idade mínima é 14 anos");
      if (ageYears > 120) return bad("Idade máxima é 120 anos");
      birthDate = birthDateRaw;
    }

    let newUserId: string | null = null;
    let tempPassword: string | null = null;

    const userMeta: Record<string, unknown> = {
      full_name: fullName,
      phone, role_title: roleTitle, department, birth_date: birthDate,
    };

    if (sendInvite) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: userMeta,
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
        user_metadata: { ...userMeta, must_reset_password: true },
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    }

    if (!newUserId) throw new Error("Falha ao criar usuário");

    // Ensure profile exists/updated
    await admin.from("profiles").upsert({
      id: newUserId, email, full_name: fullName || null,
      phone, role_title: roleTitle, department, birth_date: birthDate,
    }, { onConflict: "id" });

    // Assign roles
    const validRoles = ["admin", "diretor", "validador", "analista"];
    const filtered = roles.filter((r) => validRoles.includes(r));
    if (filtered.length) {
      await admin.from("user_roles").insert(
        filtered.map((role) => ({ user_id: newUserId, role }))
      );
    }

    if (accessRequestId) {
      await admin.from("access_requests").update({
        status: "aprovada",
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
      }).eq("id", accessRequestId);

      await admin.from("audit_log").insert({
        actor_id: userData.user.id,
        entity_type: "access_request",
        entity_id: accessRequestId,
        action: "approved",
        diff: { email, full_name: fullName, roles: filtered, created_user_id: newUserId },
      });
    }

    // Audit: user creation
    await admin.from("audit_log").insert({
      actor_id: userData.user.id,
      entity_type: "user",
      entity_id: newUserId,
      action: "created",
      diff: {
        email,
        full_name: fullName,
        roles: filtered,
        send_invite: sendInvite,
        from_access_request: accessRequestId,
      },
    });

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