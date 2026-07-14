// Cache helper para checklists gerados por IA.
// Sempre resolve hospital_id a partir do banco (nunca do body do request).

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CacheHit<T> {
  result: T;
  input_hash: string;
  updated_at: string;
  model: string | null;
}

// deno-lint-ignore no-explicit-any
export async function getChecklistCache<T = any>(
  supabase: any,
  scope: "company" | "payment_lot",
  hospitalId: string,
  scopeKey: string,
): Promise<CacheHit<T> | null> {
  const { data, error } = await supabase
    .from("ai_checklist_cache")
    .select("result, input_hash, updated_at, model")
    .eq("hospital_id", hospitalId)
    .eq("scope", scope)
    .eq("scope_key", scopeKey)
    .maybeSingle();
  if (error || !data) return null;
  return data as CacheHit<T>;
}

// deno-lint-ignore no-explicit-any
export async function saveChecklistCache(
  supabase: any,
  scope: "company" | "payment_lot",
  hospitalId: string,
  scopeKey: string,
  inputHash: string,
  // deno-lint-ignore no-explicit-any
  result: any,
  model: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("ai_checklist_cache")
    .upsert(
      {
        hospital_id: hospitalId,
        scope,
        scope_key: scopeKey,
        input_hash: inputHash,
        result,
        model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hospital_id,scope,scope_key" },
    );
  if (error) console.error("checklist cache upsert error", error);
}
