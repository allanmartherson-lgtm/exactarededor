/**
 * Helper de aprendizado de apelido de empresa.
 *
 * Por que existe: ao trocar a sugestão automática de empresa em /pagamentos/novo,
 * queremos persistir o nome bruto do arquivo como `aliases[]` na empresa correta
 * para que próximas importações reconheçam o nome sem intervenção.
 *
 * Por que via RPC: a tabela `companies` tem RLS de UPDATE restrita a admin/diretor.
 * A RPC `learn_company_alias` é SECURITY DEFINER e só permite anexar texto ao array
 * `aliases` de uma empresa específica — segura e funciona para analistas.
 *
 * Não joga exceções: retorna `{ ok, aliases?, error? }` para o caller decidir o toast.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnCompanyAliasResult =
  | { ok: true; aliases: string[] }
  | { ok: false; error: string };

export async function learnCompanyAlias(
  client: Pick<SupabaseClient, "rpc" | "from">,
  params: { companyId: string; rawName: string },
): Promise<LearnCompanyAliasResult> {
  const trimmed = params.rawName.trim();
  if (!trimmed) return { ok: false, error: "raw_name vazio" };

  const { error: rpcErr } = await client.rpc("learn_company_alias" as never, {
    _company_id: params.companyId,
    _raw_name: trimmed,
  } as never);

  if (rpcErr) return { ok: false, error: rpcErr.message ?? String(rpcErr) };

  // Recarrega o array atualizado para refletir o estado real persistido.
  const { data, error: selErr } = await client
    .from("companies")
    .select("aliases")
    .eq("id", params.companyId)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message ?? String(selErr) };

  const aliases = (((data as { aliases?: string[] } | null)?.aliases) ?? []) as string[];
  return { ok: true, aliases };
}
