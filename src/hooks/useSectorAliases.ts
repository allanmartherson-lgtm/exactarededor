import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { applySectorStems } from "@/lib/sectorStems";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";

const norm = (s: string) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-./()]+/g, "");

export type SectorAliasMap = {
  /** normalized alias/name/slug -> canonical display name */
  resolve: (raw: string | null | undefined) => string | null;
  /** normalized alias/name/slug -> canonical slug (formato usado pelo motor de regras) */
  resolveSlug: (raw: string | null | undefined) => string | null;
};

// Cache por hospital: setores exclusivos de outros hospitais não podem vazar.
const cacheByHospital = new Map<string, SectorAliasMap>();
const inflightByHospital = new Map<string, Promise<SectorAliasMap>>();

async function load(activeId: string | null): Promise<SectorAliasMap> {
  // Guarda sistêmica: null vindo do caller significa "resolve pra mim" — nunca
  // silenciosamente cair no bucket "__global__" e devolver cadastro incompleto.
  const effectiveId = activeId ?? (await resolveActiveHospitalId());
  const cacheKey = effectiveId ?? "__global__";
  const cached = cacheByHospital.get(cacheKey);
  if (cached) return cached;
  const inflight = inflightByHospital.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    // Escopo: setores globais (hospital_id IS NULL) + do hospital ativo.
    let query = supabase.from("sectors").select("slug,name,aliases,hospital_id");
    query = effectiveId
      ? query.or(`hospital_id.is.null,hospital_id.eq.${effectiveId}`)
      : query.is("hospital_id", null);
    const { data } = await query;

    const nameMap = new Map<string, string>();
    const slugMap = new Map<string, string>();
    for (const row of data ?? []) {
      const name = (row as any).name as string;
      const slug = (row as any).slug as string;
      const aliases = ((row as any).aliases ?? []) as string[];
      const isHospitalScoped = !!(row as any).hospital_id;
      for (const key of [name, slug, ...aliases]) {
        if (!key) continue;
        const n = norm(key);
        if (!n) continue;
        // Hospital-específico vence global (mesmo texto → slug local do hospital).
        if (!nameMap.has(n) || isHospitalScoped) {
          nameMap.set(n, name);
          slugMap.set(n, slug);
        }
      }
    }
    const lookup = <T,>(m: Map<string, T>) => (raw: string | null | undefined): T | null => {
      if (!raw) return null;
      const stem = applySectorStems(raw);
      if (stem && m.has(norm(stem))) return m.get(norm(stem))!;
      const n = norm(raw);
      if (!n) return null;
      if (m.has(n)) return m.get(n)!;
      for (const [k, v] of m) {
        if (n.startsWith(k) && k.length >= 4) return v;
      }
      return null;
    };
    const map: SectorAliasMap = { resolve: lookup(nameMap), resolveSlug: lookup(slugMap) };
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

/** Carrega o mapa de aliases sob demanda (fora de hook). Passe o hospital ativo se aplicável. */
export async function loadSectorAliases(activeHospitalId: string | null = null): Promise<SectorAliasMap> {
  return load(activeHospitalId);
}

/** Invalida o cache — chamar ao trocar de hospital ou após editar setores. */
export function invalidateSectorAliasesCache() {
  cacheByHospital.clear();
  inflightByHospital.clear();
}

export function useSectorAliases(): SectorAliasMap | null {
  const { hospital } = useHospital() as { hospital: { id: string } | null };
  const activeId = hospital?.id ?? null;
  const cacheKey = activeId ?? "__global__";
  const [state, setState] = useState<SectorAliasMap | null>(
    cacheByHospital.get(cacheKey) ?? null,
  );
  useEffect(() => {
    let active = true;
    load(activeId).then((m) => { if (active) setState(m); });
    return () => { active = false; };
  }, [activeId]);
  return state;
}
