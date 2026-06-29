import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type NavLayout = "top" | "side";

const STORAGE_KEY = "nav-layout";

interface NavLayoutContextValue {
  layout: NavLayout;
  setLayout: (l: NavLayout) => void;
  toggleLayout: () => void;
}

const NavLayoutContext = createContext<NavLayoutContextValue | undefined>(undefined);

function getInitialLayout(): NavLayout {
  if (typeof window === "undefined") return "side";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "top" ? "top" : "side";
}

export const NavLayoutProvider = ({ children }: { children: ReactNode }) => {
  const [layout, setLayoutState] = useState<NavLayout>(getInitialLayout);
  // Evita gravar no banco antes de termos carregado a preferência do usuário.
  const hydratedFromDb = useRef(false);

  // Aplica no <html> + localStorage sempre que mudar.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.navLayout = layout;
    window.localStorage.setItem(STORAGE_KEY, layout);
  }, [layout]);

  // 1) Hidrata do profiles.preferences.nav_layout (sincroniza entre dispositivos).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) {
        hydratedFromDb.current = true;
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const prefs = (data?.preferences ?? {}) as { nav_layout?: NavLayout };
      if (prefs.nav_layout === "top" || prefs.nav_layout === "side") {
        setLayoutState(prefs.nav_layout);
      }
      hydratedFromDb.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Persiste mudanças no banco (apenas depois da hidratação inicial).
  useEffect(() => {
    if (!hydratedFromDb.current) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId || cancelled) return;
      const { data: cur } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const merged = { ...((cur?.preferences ?? {}) as Record<string, unknown>), nav_layout: layout };
      await supabase.from("profiles").update({ preferences: merged }).eq("id", userId);
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
