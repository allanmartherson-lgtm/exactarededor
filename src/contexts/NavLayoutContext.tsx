import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type NavLayout = "top" | "side";

const STORAGE_KEY = "nav-layout";
const userKey = (userId: string) => `nav-layout:${userId}`;

interface NavLayoutContextValue {
  layout: NavLayout;
  setLayout: (l: NavLayout) => void;
  toggleLayout: () => void;
}

const NavLayoutContext = createContext<NavLayoutContextValue | undefined>(undefined);

function readLayout(key: string): NavLayout | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(key);
  return v === "top" || v === "side" ? v : null;
}

function getInitialLayout(): NavLayout {
  return readLayout(STORAGE_KEY) ?? "side";
}

export const NavLayoutProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [layout, setLayoutState] = useState<NavLayout>(getInitialLayout);
  const hydratedFromDb = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  // Aplica no <html> + localStorage (global e por-usuário) sempre que mudar.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.navLayout = layout;
    try {
      window.localStorage.setItem(STORAGE_KEY, layout);
      const uid = currentUserIdRef.current;
      if (uid) window.localStorage.setItem(userKey(uid), layout);
    } catch {
      // ignore
    }
  }, [layout]);

  // Hidrata da preferência salva: cache por-usuário (instantâneo) e DB (autoridade).
  const hydrateForUser = async (userId: string) => {
    currentUserIdRef.current = userId;

    // 1) Aplicação instantânea via cache por-usuário (evita flicker no refresh/login)
    const cached = readLayout(userKey(userId));
    if (cached) setLayoutState(cached);

    // 2) Reconcilia com o banco (fonte da verdade, sincroniza entre dispositivos)
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();
    const prefs = (data?.preferences ?? {}) as { nav_layout?: NavLayout };
    if (prefs.nav_layout === "top" || prefs.nav_layout === "side") {
      setLayoutState(prefs.nav_layout);
      try {
        window.localStorage.setItem(userKey(userId), prefs.nav_layout);
      } catch {
        // ignore
      }
    }
    hydratedFromDb.current = true;
  };

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const uid = user?.id ?? null;
    if (uid) {
      void hydrateForUser(uid);
    } else {
      currentUserIdRef.current = null;
      hydratedFromDb.current = true;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      const uid = sess?.user?.id ?? null;
      if (event === "SIGNED_OUT" || !uid) {
        currentUserIdRef.current = null;
        hydratedFromDb.current = true;
        return;
      }
      if (currentUserIdRef.current !== uid) {
        hydratedFromDb.current = false;
        void hydrateForUser(uid);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [authLoading, user?.id]);

  // Persiste mudanças no banco (apenas depois da hidratação inicial).
  useEffect(() => {
    if (!hydratedFromDb.current) return;
    const uid = currentUserIdRef.current;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data: cur } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      const merged = { ...((cur?.preferences ?? {}) as Record<string, unknown>), nav_layout: layout };
      await supabase.from("profiles").update({ preferences: merged }).eq("id", uid);
    })();
    return () => {
      cancelled = true;
    };
  }, [layout]);

  const setLayout = (l: NavLayout) => setLayoutState(l);
  const toggleLayout = () => setLayoutState((l) => (l === "top" ? "side" : "top"));

  return (
    <NavLayoutContext.Provider value={{ layout, setLayout, toggleLayout }}>
      {children}
    </NavLayoutContext.Provider>
  );
};

export const useNavLayout = () => {
  const ctx = useContext(NavLayoutContext);
  if (!ctx) throw new Error("useNavLayout must be used within NavLayoutProvider");
  return ctx;
};
