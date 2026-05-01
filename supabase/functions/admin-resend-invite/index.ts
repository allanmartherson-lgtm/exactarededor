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
    return /(^|\.)lovable\.(app|dev)$/.test(u.hostname) || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verifica que quem chama é admin
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
      return new Response(JSON.stringify({ error: "Apenas administradores podem reenviar convites" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const rawOrigin = String(body?.app_origin ?? "").trim();
    if (!email) {
      return new Response(JSON.stringify({ error: "E-mail obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const appOrigin = isAllowedOrigin(rawOrigin) ? rawOrigin.replace(/\/+$/, "") : "";
    const redirectTo = appOrigin ? `${appOrigin}/definir-senha` : undefined;

    // Descobre se o usuário já confirmou o e-mail. Se nunca confirmou, reenvia "invite"; senão "recovery".
    // Busca via listUsers (paginação básica por e-mail).
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1, perPage: 200,
    });
    if (listErr) throw listErr;
    const target = list?.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (!target) {
      return new Response(JSON.stringify({ error: "Usuário não encontrado." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const linkType: "invite" | "recovery" = target.email_confirmed_at ? "recovery" : "invite";

    // generateLink dispara o e-mail nativo do Supabase quando SMTP está configurado (default no Lovable Cloud).
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
      type: linkType,
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (genErr) throw genErr;

    return new Response(JSON.stringify({
      success: true,
      kind: linkType,                 // "invite" (primeiro acesso) ou "recovery" (redefinir senha)
      action_link: gen?.properties?.action_link ?? null, // backup manual caso e-mail não chegue
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("admin-resend-invite error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
