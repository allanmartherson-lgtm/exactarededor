import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SystemRelease = {
  id: string;
  version: string;
  title: string;
  changelog: string;
  release_type: string;
  is_current: boolean;
  published: boolean;
  released_at: string;
};

/** Retorna a release atual (is_current = true) — cache por sessão. */
export function useCurrentVersion() {
  const [release, setRelease] = useState<SystemRelease | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("system_releases" as never)
        .select("*")
        .eq("is_current", true)
        .eq("published", true)
        .maybeSingle();
      if (mounted) {
        setRelease((data as SystemRelease | null) ?? null);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);
  return { release, loading };
}
