import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Gera senha temporária forte e legível: 4 letras + 4 dígitos + símbolo + maiúscula
const generateTempPassword = () => {
  const letters = "abcdefghijkmnopqrstuvwxyz"; // sem 'l'
  const digits = "23456789"; // sem 0/1
  const sym = "!@#$%&*";
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join("");
  // Ex.: Mpay-abcd-2345!
  const block = `${pick(letters, 4)}-${pick(digits, 4)}`;
  const upper = letters[Math.floor(Math.random() * letters.length)].toUpperCase();
  return `Mpay${upper}-${block}${sym[Math.floor(Math.random() * sym.length)]}`;
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
    const targetEmail = String(body.email ?? "").trim().toLowerCase();
    if (!targetUserId && !targetEmail) {
      return new Response(JSON.stringify({ error: "Informe user_id ou email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user id
    let resolvedId = targetUserId;
    let resolvedEmail = targetEmail;
    if (!resolvedId) {
      // procura via listUsers (até 200)
      const { data: list, error: lerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (lerr) throw lerr;
      const found = list.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (!found) {
        return new Response(JSON.stringify({ error: "Usuário não encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedId = found.id;
      resolvedEmail = found.email ?? targetEmail;
    } else if (!resolvedEmail) {
      const { data: u } = await admin.auth.admin.getUserById(resolvedId);
      resolvedEmail = u.user?.email ?? "";
    }

    // Bloqueia auto-reset (admin não pode resetar a própria senha por aqui)
    if (resolvedId === userData.user.id) {
      return new Response(JSON.stringify({ error: "Use “Esqueci minha senha” para resetar a sua própria senha." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tempPassword = generateTempPassword();

    // Recupera metadata atual para preservar full_name etc.
    const { data: existing } = await admin.auth.admin.getUserById(resolvedId);
    const prevMeta = (existing.user?.user_metadata ?? {}) as Record<string, unknown>;

    const { error: updErr } = await admin.auth.admin.updateUserById(resolvedId, {
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        ...prevMeta,
        must_reset_password: true,
        password_reset_at: new Date().toISOString(),
        password_reset_by: userData.user.id,
      },
    });
    if (updErr) throw updErr;

    return new Response(
      JSON.stringify({
        success: true,
        user_id: resolvedId,
        email: resolvedEmail,
        temp_password: tempPassword,
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
