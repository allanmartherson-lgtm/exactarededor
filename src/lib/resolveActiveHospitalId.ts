/**
 * Fonte única de verdade para "qual é o hospital ativo AGORA" quando um
 * loader/resolver é chamado sem receber o id explicitamente.
 *
 * Por que existe: o padrão que se repetiu mais de uma vez foi um caller
 * chamar `loadConvenioRegistry(null)` / `loadSectorAliases(null)` antes do
 * `HospitalContext` estar hidratado. Isso fazia o loader cachear "só global"
 * (hospital_id IS NULL) e devolver essa versão incompleta para os próximos
 * consumidores da mesma sessão — o alias hospital-específico (ex.: "Codevasf
 * - Casec" no Santa Helena) sumia do resolver e reaparecia como "não
 * resolvido" no painel.
 *
 * Solução: quando não vier id do cliente, resolvemos direto no servidor via
 * RPC `current_active_hospital()` — mesmo que qualquer RLS já usa. Assim, o
 * escopo é sempre o correto, independente da ordem de hidratação do contexto.
 *
 * Memoizado por 30s para não estourar RPC em pipelines que fazem N chamadas
 * seguidas (import de planilha grande, painel de resolução).
 */
import { supabase } from "@/integrations/supabase/client";

let cachedAt = 0;
let cachedValue: string | null = null;
let inflight: Promise<string | null> | null = null;
const TTL_MS = 30_000;

export function invalidateActiveHospitalCache(): void {
  cachedAt = 0;
  cachedValue = null;
  inflight = null;
}

export async function resolveActiveHospitalId(): Promise<string | null> {
  if (Date.now() - cachedAt < TTL_MS && cachedValue !== null) return cachedValue;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc("current_active_hospital" as never);
      if (error) return null;
      const id = (typeof data === "string" && data) ? data : null;
      cachedValue = id;
      cachedAt = Date.now();
      return id;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
