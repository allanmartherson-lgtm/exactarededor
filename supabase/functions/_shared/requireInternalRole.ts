// Shared auth guard for privileged engine/notify functions.
// Accepts either an internal service-role JWT (server-to-server) or an
// authenticated user with one of the allowed internal roles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type InternalRole =
  | "admin"
  | "diretor"
  | "validador"
  | "analista"
  | "gestao_medica";

export const DEFAULT_INTERNAL_ROLES: InternalRole[] = [
  "admin",
  "diretor",
  "validador",
  "analista",
  "gestao_medica",
];

export interface AuthCheckResult {
  ok: boolean;
  status?: number;
  error?: string;
  user_id?: string | null;
  is_internal?: boolean;
  /** Lista de hospitais aos quais o usuário chamador tem vínculo (via user_hospitals). */
  hospital_ids?: string[] | null;
  /** Hospital ativo do usuário no momento da chamada (via user_active_hospital). */
  active_hospital_id?: string | null;
}

/**
 * Require a valid caller: either service-role JWT (internal caller) or an
 * authenticated user whose role is in `allowedRoles`.
 */
export async function requireInternalOrRole(
  req: Request,
  allowedRoles: InternalRole[] = DEFAULT_INTERNAL_ROLES,
): Promise<AuthCheckResult> {
  // Aceita header `x-cron-secret` para chamadas por pg_cron/trigger internos.
  // Valor gerado (CRON_SECRET) só existe no ambiente do backend.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const providedCron = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && providedCron && providedCron === cronSecret) {
    return { ok: true, is_internal: true, user_id: null, hospital_ids: null, active_hospital_id: null };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const bearer = authHeader.replace("Bearer ", "").trim();

  // Detect internal (service-role) caller
  const serviceKeyEnv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let isInternal = bearer === serviceKeyEnv;
  if (!isInternal) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1] ?? ""));
      if (payload?.role === "service_role") isInternal = true;
    } catch { /* not a JWT */ }
  }
  if (isInternal) {
    return { ok: true, is_internal: true, user_id: null, hospital_ids: null, active_hospital_id: null };
  }

  // User JWT — must be authenticated AND have an allowed role
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes, error: userErr } = await supabase.auth.getUser(bearer);
  if (userErr || !userRes?.user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const userId = userRes.user.id;

  // Check user_roles for any allowed role
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (rolesErr) {
    return { ok: false, status: 500, error: "role_check_failed" };
  }
  const has = (roles ?? []).some((r: { role: string }) =>
    (allowedRoles as string[]).includes(r.role),
  );
  if (!has) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, is_internal: false, user_id: userId };
}

export function unauthorizedResponse(
  result: AuthCheckResult,
  corsHeaders: Record<string, string>,
) {
  return new Response(
    JSON.stringify({ error: result.error ?? "Unauthorized" }),
    {
      status: result.status ?? 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
