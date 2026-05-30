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

export type ConvenioAliasMap = {
  /** normalized alias/name/slug -> canonical display name */
  resolve: (raw: string | null | undefined) => string | null;
  /** normalized alias/name/slug -> canonical slug */
  resolveSlug: (raw: string | null | undefined) => string | null;
};

let cached: ConvenioAliasMap | null = null;
let inflight: Promise<ConvenioAliasMap> | null = null;

async function load(): Promise<ConvenioAliasMap> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.from("convenios").select("slug,name,aliases");
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
        nameMap.set(n, name);
        slugMap.set(n, slug);
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
    cached = { resolve: lookup(nameMap), resolveSlug: lookup(slugMap) };
    return cached;
  })();
  return inflight;
}

export async function loadConvenioAliases(): Promise<ConvenioAliasMap> {
  return load();
}

export function useConvenioAliases(): ConvenioAliasMap | null {
  const [state, setState] = useState<ConvenioAliasMap | null>(cached);
  useEffect(() => {
    if (cached) { setState(cached); return; }
    let active = true;
    load().then((m) => { if (active) setState(m); });
    return () => { active = false; };
  }, []);
  return state;
}
