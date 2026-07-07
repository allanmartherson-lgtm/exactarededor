// Shared helper: valida acesso do caller a um hospital específico.
// - Internal (service_role) sempre passa.
// - Users com role admin/diretor têm acesso global.
// - Demais precisam ter o hospital em user_hospitals.
//
// Sempre usar junto com requireInternalOrRole (auth base).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { AuthCheckResult } from "./requireInternalRole.ts";

export async function assertHospitalAccess(
  auth: AuthCheckResult,
  hospitalId: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!hospitalId) return { ok: false, status: 400, error: "hospital_id obrigatório" };
  if (auth.is_internal) return { ok: true };
  if (!auth.user_id) return { ok: false, status: 401, error: "Unauthorized" };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Global roles bypass
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user_id);
  const isGlobal = (roles ?? []).some((r: { role: string }) =>
    r.role === "admin" || r.role === "diretor",
  );
  if (isGlobal) return { ok: true };

  // Check user_hospitals
  const { data: uh } = await admin
    .from("user_hospitals")
    .select("hospital_id")
    .eq("user_id", auth.user_id)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (!uh) {
    return { ok: false, status: 403, error: "sem acesso a este hospital" };
  }
  return { ok: true };
}
