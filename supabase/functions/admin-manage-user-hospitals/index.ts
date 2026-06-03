import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ROLES = new Set(["admin", "diretor", "validador", "analista"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Não autenticado" });

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: "Não autenticado" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Permissão real: somente admin pode gerenciar vínculos multi-tenant.
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr) return json(500, { error: `Falha ao checar permissão: ${roleErr.message}` });
    if (!isAdmin) return json(403, { error: "Apenas administradores podem gerenciar vínculos de hospitais" });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "").trim();
    const targetUserId = String(body.user_id ?? "").trim();
    const hospitalId = String(body.hospital_id ?? "").trim();

    if (!targetUserId) return json(400, { error: "user_id obrigatório" });
    if (!hospitalId) return json(400, { error: "hospital_id obrigatório" });

    // Valida que o hospital existe e está ativo.
    const { data: hosp, error: hospErr } = await admin
      .from("hospitals")
      .select("id, active")
      .eq("id", hospitalId)
      .maybeSingle();
    if (hospErr) return json(500, { error: `Falha ao consultar hospital: ${hospErr.message}` });
    if (!hosp) return json(404, { error: "Hospital não encontrado" });
    if (hosp.active === false) return json(400, { error: "Hospital inativo" });

    // Valida que o usuário-alvo existe.
    const { data: targetProfile, error: profErr } = await admin
      .from("profiles")
      .select("id, primary_hospital_id")
      .eq("id", targetUserId)
      .maybeSingle();
    if (profErr) return json(500, { error: `Falha ao consultar usuário: ${profErr.message}` });
    if (!targetProfile) return json(404, { error: "Usuário não encontrado" });

    if (action === "link") {
      const role = String(body.role ?? "analista").trim();
      if (!VALID_ROLES.has(role)) return json(400, { error: `Role inválido: ${role}` });

      const { error: upErr } = await admin
        .from("user_hospitals")
        .upsert(
          { user_id: targetUserId, hospital_id: hospitalId, role },
          { onConflict: "user_id,hospital_id,role" },
        );
      if (upErr) return json(500, { error: `Falha ao vincular: ${upErr.message}` });

      await admin.from("audit_log").insert({
        actor_id: userData.user.id,
        entity_type: "user_hospital",
        entity_id: targetUserId,
        action: "linked",
        diff: { hospital_id: hospitalId, role },
      });

      return json(200, { success: true });
    }

    if (action === "unlink") {
      if (targetProfile.primary_hospital_id === hospitalId) {
        return json(400, {
          error: "Defina outro hospital principal antes de remover este vínculo",
        });
      }
      const { error: delErr } = await admin
        .from("user_hospitals")
        .delete()
        .eq("user_id", targetUserId)
        .eq("hospital_id", hospitalId);
      if (delErr) return json(500, { error: `Falha ao remover: ${delErr.message}` });

      await admin.from("audit_log").insert({
        actor_id: userData.user.id,
        entity_type: "user_hospital",
        entity_id: targetUserId,
        action: "unlinked",
        diff: { hospital_id: hospitalId },
      });

      return json(200, { success: true });
    }

    return json(400, { error: `Ação inválida: ${action}. Use 'link' ou 'unlink'.` });
  } catch (e) {
    console.error("admin-manage-user-hospitals error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
