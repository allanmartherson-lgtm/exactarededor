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
import { extractCompanyFromFilename } from "./parsePaymentFile";
import { invalidateRegistryCache } from "./registryLookup";

export type LearnCompanyAliasResult = {
  ok: boolean;
  aliases: string[];
  error: string | null;
};

export async function learnCompanyAlias(
  client: Pick<SupabaseClient, "rpc" | "from">,
  params: { companyId: string; rawName: string },
): Promise<LearnCompanyAliasResult> {
  const trimmed = params.rawName.trim();
  if (!trimmed) return { ok: false, aliases: [], error: "raw_name vazio" };

  const { error: rpcErr } = await client.rpc("learn_company_alias" as never, {
    _company_id: params.companyId,
    _raw_name: trimmed,
  } as never);

  if (rpcErr) return { ok: false, aliases: [], error: rpcErr.message ?? String(rpcErr) };

  // Invalida cache de PJs — próximo loadCompanies traz aliases atualizados.
  invalidateRegistryCache("companies");



  const { data, error: selErr } = await client
    .from("companies")
    .select("aliases")
    .eq("id", params.companyId)
    .maybeSingle();

  if (selErr) return { ok: false, aliases: [], error: selErr.message ?? String(selErr) };

  const aliases = (((data as { aliases?: string[] } | null)?.aliases) ?? []) as string[];
  return { ok: true, aliases, error: null };
}

/**
 * Simétrico ao `learnCompanyAlias` — remove o apelido exato passado do array
 * `aliases` da PJ. Usado no botão "Desfazer aprendizado" que aparece no toast
 * logo após o vínculo, dando janela para o analista corrigir se percebeu que
 * apontou pra PJ errada.
 *
 * Nunca renomeia a empresa nem toca outros campos — a RPC no banco só chama
 * `array_remove` com match exato.
 */
export async function unlearnCompanyAlias(
  client: Pick<SupabaseClient, "rpc">,
  params: { companyId: string; rawName: string },
): Promise<{ ok: boolean; error: string | null }> {
  const trimmed = params.rawName.trim();
  if (!trimmed) return { ok: false, error: "raw_name vazio" };

  const { error } = await client.rpc("unlearn_company_alias" as never, {
    _company_id: params.companyId,
    _raw_name: trimmed,
  } as never);

  if (error) return { ok: false, error: error.message ?? String(error) };
  invalidateRegistryCache("companies");
  return { ok: true, error: null };
}

/**
 * Decide se vale chamar `learnCompanyAlias` para o par (rawName, empresa).
 * Evita escrita redundante quando o nome bruto já é exatamente o `name` ou
 * já está em `aliases` (comparação case-insensitive + trim). Também rejeita
 * rawName vazio/whitespace — alinhado ao guard interno do helper.
 *
 * Centralizado aqui para que tanto a "troca manual" quanto a "confirmação
 * de sugestão" em /pagamentos/novo usem a MESMA regra — e seja testável.
 */
export function shouldLearnAlias(
  rawName: string | null | undefined,
  company: { name?: string | null; aliases?: string[] | null } | null | undefined,
): boolean {
  const trimmed = (rawName ?? "").trim();
  if (!trimmed) return false;
  if (!company) return false;
  const key = trimmed.toLowerCase();
  const companyName = (company.name ?? "").trim().toLowerCase();
  if (companyName === key) return false;
  if ((company.aliases ?? []).some((a) => (a ?? "").trim().toLowerCase() === key)) return false;
  // Não aprender alias contaminado por sufixo do arquivo (setor/período/versão).
  // Ex.: "R E I Servicos Medicos Ltda - Parecer Adulto" depois de limpo = "R E I Servicos Medicos Ltda"
  // que é praticamente igual ao name → salvar isso polui o matching de OUTROS arquivos
  // que tenham o mesmo sufixo "- Parecer Adulto" (gera falsos positivos cruzados).
  const cleaned = extractCompanyFromFilename(trimmed).trim().toLowerCase();
  if (cleaned && cleaned === companyName) return false;
  return true;
}
