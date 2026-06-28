import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { COMMON_SPECIALTIES_FALLBACK } from "@/lib/specialties";

export interface SpecialtyRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface UseSpecialtiesOptions {
  /** Inclui também as inativas (para a tela de cadastro). Padrão: false. */
  includeInactive?: boolean;
}

// Cache em módulo para evitar refetch em todas as telas.
let cache: { rows: SpecialtyRow[]; at: number } | null = null;
let inflight: Promise<SpecialtyRow[]> | null = null;
const TTL_MS = 5 * 60 * 1000;

async function fetchAll(): Promise<SpecialtyRow[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from("specialties")
      .select("id,code,name,active")
      .order("name", { ascending: true });
    inflight = null;
    if (error) {
      console.error("[useSpecialties] fetch error", error);
      return [];
    }
    cache = { rows: (data ?? []) as SpecialtyRow[], at: Date.now() };
    return cache.rows;
  })();
  return inflight;
}

export function invalidateSpecialtiesCache() {
  cache = null;
}

/**
 * Hook único para ler o catálogo de especialidades do banco.
 * Substitui o array hardcoded `COMMON_SPECIALTIES`.
 *
 * - `specialties`: lista de nomes (ativas por padrão), pronta para alimentar selects.
 * - Enquanto carrega pela 1ª vez, devolve o fallback estático para evitar flash vazio.
 */
export function useSpecialties(opts: UseSpecialtiesOptions = {}) {
  const includeInactive = !!opts.includeInactive;
  const [rows, setRows] = useState<SpecialtyRow[]>(() => cache?.rows ?? []);
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    let cancel = false;
    if (cache && Date.now() - cache.at < TTL_MS) {
      setRows(cache.rows);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAll().then((r) => {
      if (cancel) return;
      setRows(r);
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(
    () => (includeInactive ? rows : rows.filter((r) => r.active)),
    [rows, includeInactive],
  );

  const specialties = useMemo(() => {
    if (filtered.length === 0 && loading) return COMMON_SPECIALTIES_FALLBACK;
    return filtered.map((r) => r.name);
  }, [filtered, loading]);

  const byCode = useMemo(() => {
    const m = new Map<string, SpecialtyRow>();
    rows.forEach((r) => m.set(r.code, r));
    return m;
  }, [rows]);

  const byName = useMemo(() => {
    const m = new Map<string, SpecialtyRow>();
    rows.forEach((r) => m.set(r.name.toLowerCase(), r));
    return m;
  }, [rows]);

  return {
    specialties,
    rows: filtered,
    allRows: rows,
    loading,
    byCode,
    byName,
    refetch: async () => {
      invalidateSpecialtiesCache();
      const r = await fetchAll();
      setRows(r);
      return r;
    },
  };
}
