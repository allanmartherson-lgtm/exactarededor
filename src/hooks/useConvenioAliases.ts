import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";


const norm = (s: string) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./()]+/g, "");

export type ConvenioAliasMap = {
  /** normalized alias/name/slug -> canonical display name */
  resolve: (raw: string | null | undefined) => string | null;
  /** normalized alias/name/slug -> canonical slug */
  resolveSlug: (raw: string | null | undefined) => string | null;
};

// Cache por hospital: convênios exclusivos de outros hospitais não podem vazar.
// Chave = active hospital id ("__global__" quando não há hospital selecionado).
const cacheByHospital = new Map<string, ConvenioAliasMap>();
const inflightByHospital = new Map<string, Promise<ConvenioAliasMap>>();

async function load(activeId: string | null): Promise<ConvenioAliasMap> {
  const cacheKey = activeId ?? "__global__";
  const cached = cacheByHospital.get(cacheKey);
  if (cached) return cached;

  if (cached) return cached;
  const inflight = inflightByHospital.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    // Escopo: convênios globais (hospital_id IS NULL) + do hospital ativo.
    // Convênios de outros hospitais são invisíveis para este resolver.
    let query = supabase.from("convenios").select("slug,name,aliases,hospital_id");
    query = activeId
      ? query.or(`hospital_id.is.null,hospital_id.eq.${activeId}`)
      : query.is("hospital_id", null);
    const { data } = await query;

    const nameMap = new Map<string, string>();
    const slugMap = new Map<string, string>();
    for (const row of data ?? []) {
      const name = (row as any).name as string;
      const slug = (row as any).slug as string;
      const aliases = ((row as any).aliases ?? []) as string[];
      for (const key of [name, slug, ...aliases]) {
        if (!key) continue;
        const n = norm(key);
        if (!n) continue;
        // Hospital-específico vence global (mesmo alias apontando para slug local).
        const isHospitalScoped = !!(row as any).hospital_id;
        if (!nameMap.has(n) || isHospitalScoped) {
          nameMap.set(n, name);
          slugMap.set(n, slug);
        }
      }
    }
    const lookup = <T,>(m: Map<string, T>) => (raw: string | null | undefined): T | null => {
      if (!raw) return null;
      const n = norm(raw);
      if (!n) return null;
      if (m.has(n)) return m.get(n)!;
      for (const [k, v] of m) {
        if (n.startsWith(k) && k.length >= 4) return v;
      }
      return null;
    };
    const map: ConvenioAliasMap = { resolve: lookup(nameMap), resolveSlug: lookup(slugMap) };
    cacheByHospital.set(cacheKey, map);
    return map;
  })();

  inflightByHospital.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightByHospital.delete(cacheKey);
  }
}

export async function loadConvenioAliases(activeHospitalId: string | null = null): Promise<ConvenioAliasMap> {
  return load(activeHospitalId);
}

/** Invalida o cache — chamar ao trocar de hospital ou após editar convênios. */
export function invalidateConvenioAliasesCache() {
  cacheByHospital.clear();
  inflightByHospital.clear();
}

export function useConvenioAliases(): ConvenioAliasMap | null {
  const { hospital } = useHospital() as { hospital: { id: string } | null };
  const activeId = hospital?.id ?? null;
  const cacheKey = activeId ?? "__global__";
  const [state, setState] = useState<ConvenioAliasMap | null>(
    cacheByHospital.get(cacheKey) ?? null,
  );
  useEffect(() => {
    let active = true;
    load(activeId).then((m) => { if (active) setState(m); });
    return () => { active = false; };
  }, [activeId]);
  return state;
}

