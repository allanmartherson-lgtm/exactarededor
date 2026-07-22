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
  /** true quando o usuário tem role global (admin ou diretor) — bypassa checagem de hospital. */
  has_global_scope?: boolean;
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
  // Aceita tanto CRON_SECRET (legado) quanto INTERNAL_CRON_TOKEN (atual —
  // usado no cron.schedule após o hardening que quebrou o Bearer anon key).
  const providedCron = req.headers.get("x-cron-secret") ?? "";
  if (providedCron) {
    const legacyCronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const internalCronToken = Deno.env.get("INTERNAL_CRON_TOKEN") ?? "";
    const matchesLegacy = legacyCronSecret !== "" && providedCron === legacyCronSecret;
    const matchesInternal = internalCronToken !== "" && providedCron === internalCronToken;
    if (matchesLegacy || matchesInternal) {
      return { ok: true, is_internal: true, user_id: null, hospital_ids: null, active_hospital_id: null };
    }
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
  const rolesList = (roles ?? []).map((r: { role: string }) => r.role);
  const has = rolesList.some((r) => (allowedRoles as string[]).includes(r));
  if (!has) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  const hasGlobalScope = rolesList.includes("admin") || rolesList.includes("diretor");

  // Extrai escopo de hospital do chamador (best-effort — nunca bloqueia auth).
  // hospital_ids: todos os vínculos em user_hospitals.
  // active_hospital_id: hospital atualmente ativo (user_active_hospital).
  let hospitalIds: string[] = [];
  let activeHospitalId: string | null = null;
  try {
    const [{ data: uh }, { data: uah }] = await Promise.all([
      admin.from("user_hospitals").select("hospital_id").eq("user_id", userId),
      admin.from("user_active_hospital").select("hospital_id").eq("user_id", userId).maybeSingle(),
    ]);
    hospitalIds = (uh ?? [])
      .map((r: { hospital_id: string | null }) => r.hospital_id)
      .filter((v: string | null): v is string => typeof v === "string" && v.length > 0);
    activeHospitalId = (uah as { hospital_id?: string | null } | null)?.hospital_id ?? null;
  } catch { /* best-effort */ }

  return {
    ok: true,
    is_internal: false,
    user_id: userId,
    hospital_ids: hospitalIds,
    active_hospital_id: activeHospitalId,
    has_global_scope: hasGlobalScope,
  };
}

/**
 * Verifica se o chamador pode operar sobre `targetHospitalId`.
 * - Chamadas internas (service_role, cron) são trusted → sempre true.
 * - Usuários autenticados: true se o hospital estiver na lista de vínculos.
 *
 * NÃO substitui a checagem de role — usar em conjunto com requireInternalOrRole.
 */
export function assertCallerHospital(
  auth: AuthCheckResult,
  targetHospitalId: string,
): boolean {
  if (!auth.ok) return false;
  if (auth.is_internal) return true;
  if (auth.has_global_scope) return true;
  if (!targetHospitalId) return false;
  const ids = auth.hospital_ids ?? [];
  return ids.includes(targetHospitalId);
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
