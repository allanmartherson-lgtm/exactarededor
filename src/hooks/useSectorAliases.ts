import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
};

let cached: SectorAliasMap | null = null;
let inflight: Promise<SectorAliasMap> | null = null;

async function load(): Promise<SectorAliasMap> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.from("sectors").select("slug,name,aliases");
    const map = new Map<string, string>();
    for (const row of data ?? []) {
      const name = (row as any).name as string;
      const slug = (row as any).slug as string;
      const aliases = ((row as any).aliases ?? []) as string[];
      for (const key of [name, slug, ...aliases]) {
        if (!key) continue;
        const n = norm(key);
        if (n) map.set(n, name);
        // also a "prefix" key (strip trailing parentheticals like "(DFStar)")
      }
    }
    cached = {
      resolve: (raw) => {
        if (!raw) return null;
        const n = norm(raw);
        if (!n) return null;
        if (map.has(n)) return map.get(n)!;
        // try without trailing parenthetical content e.g. "hemodinamicadfstar" -> match "hemodinamica"
        for (const [k, v] of map) {
          if (n.startsWith(k) && k.length >= 4) return v;
        }
        return null;
      },
    };
    return cached;
  })();
  return inflight;
}

export function useSectorAliases(): SectorAliasMap | null {
  const [state, setState] = useState<SectorAliasMap | null>(cached);
  useEffect(() => {
    if (cached) { setState(cached); return; }
    let active = true;
    load().then((m) => { if (active) setState(m); });
    return () => { active = false; };
  }, []);
  return state;
}
