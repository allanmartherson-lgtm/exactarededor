/**
 * Helpers para resolver IDs entre `payment_types` (legado, unificado) e as
 * tabelas canônicas `payment_models` (modelo do lote) / `item_types` (tipo
 * do item). A relação é feita por `code` — todo `payment_types.code` aparece
 * em EXATAMENTE UMA das duas tabelas (partição limpa validada em D3.e).
 *
 * Uso típico durante a transição D3.e:
 *  - UI ainda usa `usePaymentTypes` e tem um `payment_types.id` em mãos.
 *  - Para gravar na coluna nova (`payment_model_id` / `item_type_id` / `default_item_type_id` etc.),
 *    chama um destes resolvers antes do INSERT/UPDATE.
 *  - Após D3.e.2 (migração de combos para `usePaymentModels` / `useItemTypes`)
 *    estes helpers ficam dispensáveis e podem ser removidos em D3.e.4.
 *
 * Cache: lookup carregado uma vez por sessão (codes raramente mudam). Use
 * `clearPaymentTypeResolverCache()` em testes ou após mutações administrativas
 * na tabela de tipos.
 */
import { supabase } from "@/integrations/supabase/client";

type CacheShape = {
  /** payment_types.id → code */
  ptIdToCode: Map<string, string>;
  /** code → payment_models.id */
  codeToPaymentModelId: Map<string, string>;
  /** code → item_types.id */
  codeToItemTypeId: Map<string, string>;
};

let cache: CacheShape | null = null;
let loadingPromise: Promise<CacheShape> | null = null;

async function loadCache(): Promise<CacheShape> {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const [ptRes, pmRes, itRes] = await Promise.all([
      supabase.from("payment_types").select("id, code"),
      supabase.from("payment_models" as any).select("id, code"),
      supabase.from("item_types" as any).select("id, code"),
    ]);
    const next: CacheShape = {
      ptIdToCode: new Map(),
      codeToPaymentModelId: new Map(),
      codeToItemTypeId: new Map(),
    };
    for (const r of (ptRes.data ?? []) as Array<{ id: string; code: string }>) {
      next.ptIdToCode.set(r.id, r.code);
    }
    for (const r of ((pmRes.data ?? []) as unknown) as Array<{ id: string; code: string }>) {
      next.codeToPaymentModelId.set(r.code, r.id);
    }
    for (const r of ((itRes.data ?? []) as unknown) as Array<{ id: string; code: string }>) {
      next.codeToItemTypeId.set(r.code, r.id);
    }
    cache = next;
    loadingPromise = null;
    return next;
  })();
  return loadingPromise;
}

export function clearPaymentTypeResolverCache(): void {
  cache = null;
  loadingPromise = null;
}

/**
 * Dado um `payment_types.id`, retorna o `payment_models.id` correspondente
 * (mesmo `code`). Retorna `null` quando o code não pertence ao universo
 * "modelo de lote" (ex.: `parecer_adulto`, `cirurgia`).
 */
export async function resolvePaymentModelIdFromPaymentTypeId(
  paymentTypeId: string | null | undefined,
): Promise<string | null> {
  if (!paymentTypeId) return null;
  const c = await loadCache();
  const code = c.ptIdToCode.get(paymentTypeId);
  if (!code) return null;
  return c.codeToPaymentModelId.get(code) ?? null;
}

/**
 * Dado um `payment_types.id`, retorna o `item_types.id` correspondente
 * (mesmo `code`). Retorna `null` quando o code é de modelo de lote.
 */
export async function resolveItemTypeIdFromPaymentTypeId(
  paymentTypeId: string | null | undefined,
): Promise<string | null> {
  if (!paymentTypeId) return null;
  const c = await loadCache();
  const code = c.ptIdToCode.get(paymentTypeId);
  if (!code) return null;
  return c.codeToItemTypeId.get(code) ?? null;
}

/**
 * Versão batch para arrays (ex.: `company_financial_adjustments.payment_type_ids[]`
 * → `payment_model_ids[]`). IDs que não mapeiam são DROPADOS do resultado.
 */
export async function resolvePaymentModelIdsFromPaymentTypeIds(
  ids: ReadonlyArray<string> | null | undefined,
): Promise<string[]> {
  if (!ids || ids.length === 0) return [];
  const c = await loadCache();
  const out: string[] = [];
  for (const id of ids) {
    const code = c.ptIdToCode.get(id);
    if (!code) continue;
    const mapped = c.codeToPaymentModelId.get(code);
    if (mapped) out.push(mapped);
  }
  return out;
}
