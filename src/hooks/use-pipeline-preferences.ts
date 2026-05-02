import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Preferências do pipeline do dashboard, persistidas:
 *  1. em localStorage (cache imediato, sobrevive a reload offline)
 *  2. em `profiles.preferences` (server-side, sincroniza entre dispositivos)
 *
 * Estratégia:
 *  - Boot síncrono lê do localStorage para evitar flash de layout.
 *  - Ao montar, busca o perfil do usuário; valores do servidor vencem
 *    sobre o cache local (assumimos que outro dispositivo pode ter mudado).
 *  - Toda mutação faz write-through: localStorage imediato + UPDATE
 *    no `profiles` em background (debounced).
 */

export type PipelineLayout = "auto" | "rows2" | "rows3";
export type PipelineOwnerFilter = "all" | "analista" | "validador" | "diretor";
export type PipelineWindowFilter = "7" | "30" | "90" | "all";

export interface PipelinePreferences {
  layout: PipelineLayout;
  owner: PipelineOwnerFilter;
  window: PipelineWindowFilter;
}

const DEFAULTS: PipelinePreferences = {
  layout: "auto",
  owner: "all",
  window: "all",
};

const LS_KEYS = {
  layout: "dashboard.pipelineLayout",
  owner: "dashboard.pipelineOwner",
  window: "dashboard.pipelineWindow",
} as const;

/** Chaves usadas dentro do JSONB `profiles.preferences`. */
const REMOTE_KEYS = {
  layout: "dashboard.pipelineLayout",
  owner: "dashboard.pipelineOwner",
  window: "dashboard.pipelineWindow",
} as const;

const isLayout = (v: unknown): v is PipelineLayout =>
  v === "auto" || v === "rows2" || v === "rows3";
const isOwner = (v: unknown): v is PipelineOwnerFilter =>
  v === "all" || v === "analista" || v === "validador" || v === "diretor";
const isWindow = (v: unknown): v is PipelineWindowFilter =>
  v === "7" || v === "30" || v === "90" || v === "all";

const readFromLocalStorage = (): PipelinePreferences => {
  if (typeof window === "undefined") return DEFAULTS;
  const layout = window.localStorage.getItem(LS_KEYS.layout);
  const owner = window.localStorage.getItem(LS_KEYS.owner);
  const win = window.localStorage.getItem(LS_KEYS.window);
  return {
    layout: isLayout(layout) ? layout : DEFAULTS.layout,
    owner: isOwner(owner) ? owner : DEFAULTS.owner,
    window: isWindow(win) ? win : DEFAULTS.window,
  };
};

const writeToLocalStorage = (prefs: PipelinePreferences) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEYS.layout, prefs.layout);
  window.localStorage.setItem(LS_KEYS.owner, prefs.owner);
  window.localStorage.setItem(LS_KEYS.window, prefs.window);
};

const fromRemoteJson = (raw: unknown): Partial<PipelinePreferences> => {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<PipelinePreferences> = {};
  const layout = obj[REMOTE_KEYS.layout];
  const owner = obj[REMOTE_KEYS.owner];
  const win = obj[REMOTE_KEYS.window];
  if (isLayout(layout)) out.layout = layout;
  if (isOwner(owner)) out.owner = owner;
  if (isWindow(win)) out.window = win;
  return out;
};

export function usePipelinePreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PipelinePreferences>(() => readFromLocalStorage());
  /** Evita escrever no servidor antes do primeiro carregamento remoto terminar. */
  const remoteHydrated = useRef(false);
  /** Debounce do PATCH no servidor. */
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidratação remota: o servidor é a fonte da verdade entre dispositivos.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      remoteHydrated.current = true;
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      remoteHydrated.current = true;
      if (error || !data) return;
      const remote = fromRemoteJson((data as { preferences: unknown }).preferences);
      if (Object.keys(remote).length === 0) {
        // Servidor vazio → empurra o cache local pra cima para sincronizar
        // este dispositivo com os próximos.
        const local = readFromLocalStorage();
        if (
          local.layout !== DEFAULTS.layout ||
          local.owner !== DEFAULTS.owner ||
          local.window !== DEFAULTS.window
        ) {
          void persistRemote(user.id, local);
        }
        return;
      }
      const merged: PipelinePreferences = {
        layout: remote.layout ?? prefs.layout,
        owner: remote.owner ?? prefs.owner,
        window: remote.window ?? prefs.window,
      };
      writeToLocalStorage(merged);
      setPrefs(merged);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /** Persiste TODAS as preferências no perfil (merge raso pelo cliente). */
  const persistRemote = async (userId: string, next: PipelinePreferences) => {
    // Faz merge raso: lê o que está no servidor, sobrescreve só nossas chaves.
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();
    const current =
      data && typeof (data as { preferences: unknown }).preferences === "object"
        ? ((data as { preferences: Record<string, unknown> }).preferences ?? {})
        : {};
    const merged: Record<string, unknown> = {
      ...current,
      [REMOTE_KEYS.layout]: next.layout,
      [REMOTE_KEYS.owner]: next.owner,
      [REMOTE_KEYS.window]: next.window,
    };
    await supabase.from("profiles").update({ preferences: merged }).eq("id", userId);
  };

  const update = useCallback(
    (patch: Partial<PipelinePreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        // 1) cache local imediato — sem flicker no próximo reload
        writeToLocalStorage(next);
        // 2) servidor (debounced, só após hidratação)
        if (user?.id && remoteHydrated.current) {
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          pendingTimer.current = setTimeout(() => {
            void persistRemote(user.id!, next);
          }, 400);
        }
        return next;
      });
    },
    [user?.id],
  );

  // Garante que mudanças pendentes sejam enviadas se o componente desmontar.
  useEffect(() => {
    return () => {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        if (user?.id && remoteHydrated.current) {
          // dispara fire-and-forget; sem await porque já estamos desmontando.
          void persistRemote(user.id, readFromLocalStorage());
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    layout: prefs.layout,
    owner: prefs.owner,
    window: prefs.window,
    setLayout: (v: PipelineLayout) => update({ layout: v }),
    setOwner: (v: PipelineOwnerFilter) => update({ owner: v }),
    setWindow: (v: PipelineWindowFilter) => update({ window: v }),
  };
}