import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      return new Response(JSON.stringify({ error: "Apenas administradores podem resetar senhas" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.user_id ?? "").trim();
    let targetEmail = String(body.email ?? "").trim().toLowerCase();
    const rawOrigin = String(body.app_origin ?? "").trim();
    const appOrigin = isAllowedOrigin(rawOrigin) ? rawOrigin.replace(/\/+$/, "") : "";
    const redirectTo = appOrigin ? `${appOrigin}/auth/reset-password` : undefined;

    if (!targetUserId && !targetEmail) {
      return new Response(JSON.stringify({ error: "Informe user_id ou email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let resolvedId = targetUserId;
    if (!resolvedId) {
      const { data: list, error: lerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (lerr) throw lerr;
      const found = list.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (!found) {
        return new Response(JSON.stringify({ error: "Usuário não encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedId = found.id;
      targetEmail = found.email ?? targetEmail;
    } else if (!targetEmail) {
      const { data: u } = await admin.auth.admin.getUserById(resolvedId);
      targetEmail = u.user?.email ?? "";
    }

    if (resolvedId === userData.user.id) {
      return new Response(JSON.stringify({ error: "Use \"Esqueci minha senha\" para resetar a sua própria senha." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Marca o usuário para troca obrigatória no próximo acesso (preserva metadata).
    const { data: existing } = await admin.auth.admin.getUserById(resolvedId);
    const prevMeta = (existing.user?.user_metadata ?? {}) as Record<string, unknown>;
    await admin.auth.admin.updateUserById(resolvedId, {
      user_metadata: {
        ...prevMeta,
        must_reset_password: true,
        password_reset_requested_at: new Date().toISOString(),
        password_reset_requested_by: userData.user.id,
      },
    });

    // Dispara e-mail oficial de redefinição. Se cair em rate-limit (429),
    // seguimos adiante e devolvemos um link manual para o admin compartilhar.
    let emailSent = true;
    let emailWarning: string | null = null;
    try {
      const mailer = createClient(SUPABASE_URL, ANON);
      const { error: resetErr } = await mailer.auth.resetPasswordForEmail(targetEmail, { redirectTo });
      if (resetErr) throw resetErr;
    } catch (mailErr: any) {
      const status = mailErr?.status ?? 0;
      if (status === 429) {
        emailSent = false;
        emailWarning = "Limite de envio atingido. Use o link manual abaixo para compartilhar com o usuário.";
      } else {
        throw mailErr;
      }
    }

    // Link manual de contingência (mesma rota/parâmetros que o e-mail oficial).
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: targetEmail,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (genErr) throw genErr;

    const tokenHash = gen?.properties?.hashed_token ?? null;
    const appLink = redirectTo && tokenHash
      ? `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
      : (gen?.properties?.action_link ?? null);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: resolvedId,
        email: targetEmail,
        email_sent: emailSent,
        warning: emailWarning,
        action_link: appLink,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("admin-reset-password error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
